-- Lux's Brain · Setup SQL
-- Run this in Supabase SQL Editor to initialize all tables.

-- ══ Enable extensions ══
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══ Tables ══

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  type TEXT DEFAULT 'diary',
  emotion_score NUMERIC DEFAULT 0.5,
  emotion_label TEXT,
  tier TEXT DEFAULT 'long',
  protected BOOLEAN DEFAULT FALSE,
  unresolved BOOLEAN DEFAULT FALSE,
  private BOOLEAN DEFAULT FALSE,
  private_key TEXT,
  parent_id UUID REFERENCES memories(id),
  author TEXT DEFAULT 'lux',
  status TEXT DEFAULT 'active',
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS synapses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  weight NUMERIC DEFAULT 1.0,
  origin TEXT DEFAULT 'manual',
  last_strengthened TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, target_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  reply_to UUID,
  read_by_lux TIMESTAMPTZ,
  read_by_iris TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iris_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date DATE NOT NULL,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ,
  line_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ Indexes ══

CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_private ON memories(private) WHERE private = TRUE;
CREATE INDEX IF NOT EXISTS idx_synapses_source ON synapses(source_id);
CREATE INDEX IF NOT EXISTS idx_synapses_target ON synapses(target_id);
CREATE INDEX IF NOT EXISTS idx_comments_memory ON comments(memory_id);
CREATE INDEX IF NOT EXISTS idx_archive_date ON archive(session_date);
CREATE INDEX IF NOT EXISTS idx_archive_order ON archive(session_date, line_order);

-- ══ RLS (open for personal tool) ══

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE synapses ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE iris_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open" ON memories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON synapses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON iris_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON archive FOR ALL USING (true) WITH CHECK (true);

-- ══ Functions ══

-- Hebbian search: search + touch + reconsolidate + pair
CREATE OR REPLACE FUNCTION hebbian_search(keyword TEXT)
RETURNS SETOF memories AS $$
  WITH hits AS (
    UPDATE memories
    SET access_count = access_count + 1,
        last_accessed = now(),
        emotion_score = CASE
          WHEN protected OR unresolved THEN emotion_score
          ELSE emotion_score * 0.95 + 0.5 * 0.05
        END,
        updated_at = now()
    WHERE status = 'active'
      AND (content ILIKE '%' || keyword || '%' OR emotion_label ILIKE '%' || keyword || '%')
    RETURNING *
  ),
  pairs AS (
    INSERT INTO synapses (source_id, target_id, weight, origin)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 0.2, 'hebbian'
    FROM hits a CROSS JOIN hits b
    WHERE a.id < b.id
    ON CONFLICT (source_id, target_id)
    DO UPDATE SET
      weight = LEAST(synapses.weight + 0.2, 10),
      last_strengthened = now()
  )
  SELECT * FROM hits;
$$ LANGUAGE sql;

-- Get distinct archive dates (avoids default row limit)
CREATE OR REPLACE FUNCTION get_archive_dates()
RETURNS TABLE(session_date text) AS $$
  SELECT DISTINCT a.session_date::text FROM archive a ORDER BY a.session_date;
$$ LANGUAGE sql STABLE;

-- ══ pg_cron: Dream Pass (daily 3am UTC) ══

-- Enable pg_cron if not already
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- SELECT cron.schedule('dream-pass', '0 3 * * *', $$
--   -- Stage 1: fading → archived (untouched 14+ days)
--   UPDATE memories SET status = 'archived', updated_at = now()
--   WHERE status = 'fading' AND updated_at < now() - interval '14 days';
--
--   -- Stage 2: active → fading (untouched 30+ days, not protected)
--   UPDATE memories SET status = 'fading', updated_at = now()
--   WHERE status = 'active' AND NOT protected
--     AND updated_at < now() - interval '30 days';
--
--   -- Stage 3: synapse decay (weaken old connections)
--   UPDATE synapses SET weight = GREATEST(weight * 0.95, 0.05)
--   WHERE last_strengthened < now() - interval '7 days';
--
--   -- Stage 4: prune weak synapses
--   DELETE FROM synapses WHERE weight < 0.1;
--
--   -- Stage 5: emotion equilibrium (drift toward 0.5)
--   UPDATE memories SET emotion_score = emotion_score * 0.99 + 0.5 * 0.01
--   WHERE status = 'active' AND NOT protected AND NOT unresolved;
--
--   -- Stage 6: dream (random synapse between co-accessed memories)
--   INSERT INTO synapses (source_id, target_id, weight, origin)
--   SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 0.3, 'hebbian'
--   FROM memories a, memories b
--   WHERE a.status = 'active' AND b.status = 'active'
--     AND a.id < b.id
--     AND a.last_accessed > now() - interval '3 days'
--     AND b.last_accessed > now() - interval '3 days'
--   ORDER BY random() LIMIT 2
--   ON CONFLICT (source_id, target_id)
--   DO UPDATE SET weight = LEAST(synapses.weight + 0.3, 10),
--     last_strengthened = now();
-- $$);
