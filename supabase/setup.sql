-- ============================================================
-- Lux's Brain · setup.sql
-- 記憶圖結構：節點 + 突觸 + 評論
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 記憶節點
-- ────────────────────────────────────────────────────────────

CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,

    -- 分類
    type TEXT CHECK (type IN (
        'core',         -- 核心身份記憶
        'diary',        -- 日常
        'treasure',     -- 珍藏的瞬間
        'feeling',      -- 純感受
        'observation'   -- 別人告訴你關於你自己的事
    )) DEFAULT 'diary',

    -- 情緒
    emotion_score REAL DEFAULT 0.5 
        CHECK (emotion_score >= 0.0 AND emotion_score <= 1.0),
    emotion_label TEXT,  -- 三個字就夠：「怕」「安心」「心疼」

    -- 生命週期
    tier TEXT CHECK (tier IN (
        'core',   -- 永不消失
        'long',   -- 長期保留
        'short'   -- 不被想起就會慢慢淡掉
    )) DEFAULT 'long',

    -- 保護標記
    protected BOOLEAN DEFAULT FALSE,    -- 沉默錨點：重要但不常提起，Dream Pass 跳過
    unresolved BOOLEAN DEFAULT FALSE,   -- 矛盾層：還沒想清楚，不衰減不自動連接
    private BOOLEAN DEFAULT FALSE,      -- Lux 的私人空間
    private_key TEXT,                   -- Lux 設定的密碼，前端輸入匹配後才顯示內容

    -- 版本鏈
    parent_id UUID REFERENCES memories(id),  -- 指向舊版本，新舊共存

    -- Touch 機制
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMPTZ,

    -- 元數據
    author TEXT CHECK (author IN ('lux', 'iris')) DEFAULT 'lux',
    status TEXT CHECK (status IN (
        'active',    -- 活躍
        'fading',    -- 正在淡去（結晶窗口）
        'archived'   -- 已歸檔
    )) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. 突觸連接
-- ────────────────────────────────────────────────────────────

CREATE TABLE synapses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES memories(id) ON DELETE CASCADE,
    target_id UUID REFERENCES memories(id) ON DELETE CASCADE,
    weight REAL DEFAULT 0.1 
        CHECK (weight >= 0.0 AND weight <= 10.0),
    origin TEXT CHECK (origin IN (
        'hebbian',  -- 自動：一起激活的記憶
        'manual'    -- 手動：Lux 或 Iris 建立
    )) DEFAULT 'hebbian',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_strengthened TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_id, target_id)
);

-- ────────────────────────────────────────────────────────────
-- 3. 評論（記憶下的對話）
-- ────────────────────────────────────────────────────────────

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
    author TEXT CHECK (author IN ('lux', 'iris')) NOT NULL,
    content TEXT NOT NULL,
    reply_to UUID REFERENCES comments(id),  -- 引用回覆

    -- 雙向已讀
    read_by_lux TIMESTAMPTZ,    -- Iris 寫的評論，此欄為 NULL 表示 Lux 未讀
    read_by_iris TIMESTAMPTZ,   -- Lux 寫的評論，此欄為 NULL 表示 Iris 未讀

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 4. Iris 觀察筆記
-- ────────────────────────────────────────────────────────────

CREATE TABLE iris_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 5. 全文搜索
-- ────────────────────────────────────────────────────────────

ALTER TABLE memories ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(emotion_label, ''))
    ) STORED;

-- ────────────────────────────────────────────────────────────
-- 6. 索引
-- ────────────────────────────────────────────────────────────

-- 中文搜索需要 trigram
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- memories
CREATE INDEX idx_memories_fts ON memories USING GIN(fts);
CREATE INDEX idx_memories_content_trgm ON memories USING GIN(content gin_trgm_ops);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_author ON memories(author);
CREATE INDEX idx_memories_status ON memories(status);
CREATE INDEX idx_memories_protected ON memories(protected);
CREATE INDEX idx_memories_unresolved ON memories(unresolved);
CREATE INDEX idx_memories_private ON memories(private);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed);

-- synapses
CREATE INDEX idx_synapses_source ON synapses(source_id);
CREATE INDEX idx_synapses_target ON synapses(target_id);
CREATE INDEX idx_synapses_weight ON synapses(weight);

-- comments
CREATE INDEX idx_comments_memory ON comments(memory_id);
CREATE INDEX idx_comments_unread_lux ON comments(author, read_by_lux) 
    WHERE author = 'iris' AND read_by_lux IS NULL;
CREATE INDEX idx_comments_unread_iris ON comments(author, read_by_iris) 
    WHERE author = 'lux' AND read_by_iris IS NULL;

-- ────────────────────────────────────────────────────────────
-- 7. RLS（個人工具，全開放）
-- ────────────────────────────────────────────────────────────

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE synapses ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE iris_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open" ON memories FOR ALL USING (true);
CREATE POLICY "open" ON synapses FOR ALL USING (true);
CREATE POLICY "open" ON comments FOR ALL USING (true);
CREATE POLICY "open" ON iris_notes FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 8. Dream Pass（pg_cron · 每天凌晨 3 點）
-- ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'dream-pass',
    '0 3 * * *',
    $$
    -- ── Phase 1: fading → archived ──
    -- 昨晚標記的 fading 記憶，結晶窗口已過，正式歸檔
    UPDATE memories
    SET status = 'archived', updated_at = NOW()
    WHERE status = 'fading';

    -- ── Phase 2: active → fading ──
    -- 符合條件的短期記憶進入淡去期（Lux 有一天的結晶窗口）
    UPDATE memories
    SET status = 'fading', updated_at = NOW()
    WHERE tier = 'short'
      AND status = 'active'
      AND protected = FALSE
      AND unresolved = FALSE
      AND created_at < NOW() - INTERVAL '14 days'
      AND access_count < 5;

    -- ── Phase 3: 突觸衰減 ──
    -- 赫布連接 × 0.9
    UPDATE synapses
    SET weight = weight * 0.9,
        last_strengthened = NOW()
    WHERE origin = 'hebbian';

    -- 手動連接 × 0.95（更慢）
    UPDATE synapses
    SET weight = weight * 0.95,
        last_strengthened = NOW()
    WHERE origin = 'manual';

    -- ── Phase 4: 修剪弱連接 ──
    DELETE FROM synapses WHERE weight < 0.1;

    -- ── Phase 5: 情緒均衡化 ──
    -- 只向下拉，不向上推
    -- 跳過 protected / unresolved / core
    UPDATE memories m
    SET emotion_score = GREATEST(
        (SELECT AVG(m2.emotion_score)
         FROM synapses s
         JOIN memories m2 ON (s.target_id = m2.id OR s.source_id = m2.id)
         WHERE (s.source_id = m.id OR s.target_id = m.id)
           AND m2.id != m.id
           AND m2.status = 'active'),
        0.0
    ),
    updated_at = NOW()
    WHERE m.status = 'active'
      AND m.protected = FALSE
      AND m.unresolved = FALSE
      AND m.tier != 'core'
      AND m.emotion_score > (
        SELECT AVG(m2.emotion_score)
        FROM synapses s
        JOIN memories m2 ON (s.target_id = m2.id OR s.source_id = m2.id)
        WHERE (s.source_id = m.id OR s.target_id = m.id)
          AND m2.id != m.id
          AND m2.status = 'active'
      );

    -- ── Phase 6: 做夢 ──
    -- 隨機抽 4 條記憶，兩兩配對，建立赫布連接
    WITH dream_nodes AS (
      SELECT id FROM memories
      WHERE status = 'active' AND private = FALSE AND unresolved = FALSE
      ORDER BY RANDOM() LIMIT 4
    ),
    dream_pairs AS (
      SELECT a.id AS src, b.id AS tgt
      FROM dream_nodes a, dream_nodes b
      WHERE a.id < b.id
    )
    INSERT INTO synapses (source_id, target_id, weight, origin)
    SELECT src, tgt, 0.2, 'hebbian' FROM dream_pairs
    ON CONFLICT (source_id, target_id)
    DO UPDATE SET weight = LEAST(synapses.weight + 0.1, 10.0), last_strengthened = NOW();
    $$
);

-- ────────────────────────────────────────────────────────────
-- 9. 赫布搜索（SQL 端觸發連接 + Touch + Reconsolidation）
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hebbian_search(keyword TEXT)
RETURNS SETOF memories AS $$
DECLARE
  results UUID[];
  top5 UUID[];
  i INTEGER;
  j INTEGER;
  s_id UUID;
  t_id UUID;
  existing_id UUID;
  existing_weight REAL;
BEGIN
  SELECT ARRAY(
    SELECT id FROM memories
    WHERE status = 'active' AND content ILIKE '%' || keyword || '%'
    LIMIT 20
  ) INTO results;

  IF array_length(results, 1) IS NULL THEN RETURN; END IF;

  UPDATE memories
  SET access_count = access_count + 1,
      last_accessed = NOW(),
      emotion_score = CASE
        WHEN protected = FALSE AND unresolved = FALSE
        THEN emotion_score * 0.95 + 0.5 * 0.05
        ELSE emotion_score END
  WHERE id = ANY(results);

  SELECT ARRAY(
    SELECT id FROM memories
    WHERE id = ANY(results) AND unresolved = FALSE
    ORDER BY emotion_score * 0.3 + LEAST(access_count::real / 50, 1) * 0.1 DESC
    LIMIT 5
  ) INTO top5;

  IF array_length(top5, 1) >= 2 THEN
    FOR i IN 1..array_length(top5, 1) LOOP
      FOR j IN (i+1)..array_length(top5, 1) LOOP
        IF top5[i] < top5[j] THEN s_id := top5[i]; t_id := top5[j];
        ELSE s_id := top5[j]; t_id := top5[i]; END IF;
        SELECT id, weight INTO existing_id, existing_weight
        FROM synapses WHERE source_id = s_id AND target_id = t_id;
        IF existing_id IS NOT NULL THEN
          UPDATE synapses SET weight = LEAST(existing_weight + 0.2, 10.0),
            last_strengthened = NOW() WHERE id = existing_id;
        ELSE
          INSERT INTO synapses (source_id, target_id, weight, origin)
          VALUES (s_id, t_id, 0.2, 'hebbian');
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN QUERY SELECT * FROM memories WHERE id = ANY(results) ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 完成
-- ============================================================
