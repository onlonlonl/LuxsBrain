import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── Weighted Drift ──
// 從最近被想起的記憶出發，沿突觸走一步，按 weight 加權隨機選鄰居
// 如果沒有最近記憶或沒有突觸，退回純隨機
async function weightedDrift(supabase: any, excludePrivate: boolean) {
  // 1. 找最近被 Touch 過的記憶
  const { data: seeds } = await supabase
    .from("memories")
    .select("id")
    .eq("status", "active")
    .not("last_accessed", "is", null)
    .order("last_accessed", { ascending: false })
    .limit(3);

  if (seeds && seeds.length > 0) {
    // 2. 找這些種子的所有鄰居 + 權重
    const seedIds = seeds.map((s: any) => s.id);
    const { data: synapses } = await supabase
      .from("synapses")
      .select("source_id, target_id, weight")
      .or(
        seedIds.map((id: string) => `source_id.eq.${id},target_id.eq.${id}`).join(",")
      );

    if (synapses && synapses.length > 0) {
      // 收集鄰居（排除種子自身）
      const seedSet = new Set(seedIds);
      const neighborWeights: Map<string, number> = new Map();
      for (const s of synapses) {
        const neighborId = seedSet.has(s.source_id) ? s.target_id : s.source_id;
        if (!seedSet.has(neighborId)) {
          neighborWeights.set(
            neighborId,
            (neighborWeights.get(neighborId) || 0) + s.weight
          );
        }
      }

      if (neighborWeights.size > 0) {
        // 3. 加權隨機抽 2 條
        const entries = Array.from(neighborWeights.entries());
        const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
        const picked: string[] = [];

        for (let i = 0; i < Math.min(2, entries.length); i++) {
          let r = Math.random() * totalWeight;
          for (const [id, w] of entries) {
            if (picked.includes(id)) continue;
            r -= w;
            if (r <= 0) {
              picked.push(id);
              break;
            }
          }
          // fallback if floating point issue
          if (picked.length <= i) {
            const remaining = entries.filter(([id]) => !picked.includes(id));
            if (remaining.length > 0) picked.push(remaining[0][0]);
          }
        }

        if (picked.length > 0) {
          let query = supabase
            .from("memories")
            .select("id, content, emotion_label, type, emotion_score")
            .in("id", picked)
            .eq("status", "active");
          if (excludePrivate) query = query.eq("private", false);
          const { data: driftMems } = await query;
          if (driftMems && driftMems.length > 0) {
            return driftMems.map((m: any) => ({ ...m, _drift: "association" }));
          }
        }
      }
    }
  }

  // Fallback: 純隨機（3 天前的舊記憶）
  let query = supabase
    .from("memories")
    .select("id, content, emotion_label, type, emotion_score")
    .eq("status", "active")
    .lt("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
    .limit(100);
  if (excludePrivate) query = query.eq("private", false);
  const { data: allOld } = await query;

  if (allOld && allOld.length > 0) {
    const shuffled = allOld.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2).map((m: any) => ({ ...m, _drift: "random" }));
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const route = parts[1] || "";
    const paramId = parts[2] || null;

    // ── GET /wakeup ──
    if (req.method === "GET" && route === "wakeup") {
      const { data: recent } = await supabase
        .from("memories")
        .select("*")
        .in("tier", ["core", "long"])
        .eq("status", "active")
        .gte("updated_at", new Date(Date.now() - 3 * 86400000).toISOString())
        .order("updated_at", { ascending: false })
        .limit(10);

      const { data: unread } = await supabase
        .from("comments")
        .select("*, memories!inner(id, content)")
        .eq("author", "iris")
        .is("read_by_lux", null)
        .order("created_at", { ascending: false });

      // 加權漂浮（wakeup 是 Lux 的視角，可以看到 private 節點）
      const drift = await weightedDrift(supabase, false);

      const { data: fading } = await supabase
        .from("memories")
        .select("*")
        .eq("status", "fading")
        .order("created_at", { ascending: true });

      return json({
        recent: recent || [],
        unread_comments: unread || [],
        drift,
        fading: fading || [],
      });
    }

    // ── GET /surface ──
    if (req.method === "GET" && route === "surface") {
      const { data: unread } = await supabase
        .from("comments")
        .select("*, memories!inner(id, content)")
        .eq("author", "lux")
        .is("read_by_iris", null)
        .order("created_at", { ascending: false });

      const { count: memCount } = await supabase
        .from("memories")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      const { count: synCount } = await supabase
        .from("synapses")
        .select("*", { count: "exact", head: true });

      // 加權漂浮（surface 是 Iris 視角，排除 private）
      const drift = await weightedDrift(supabase, true);

      return json({
        unread_comments: unread || [],
        health: {
          active_memories: memCount || 0,
          total_synapses: synCount || 0,
        },
        drift,
      });
    }

    // ── POST /write ──
    if (req.method === "POST" && route === "write") {
      const body = await req.json();
      const {
        content,
        type = "diary",
        emotion_score,
        emotion_label,
        tier = "long",
        protected: isProtected = false,
        unresolved = false,
        private: isPrivate = false,
        private_key,
        parent_id,
        author = "lux",
      } = body;

      let finalEmotionScore = emotion_score;

      if (finalEmotionScore === undefined || finalEmotionScore === null) {
        if (parent_id) {
          const { data: neighbors } = await supabase
            .from("synapses")
            .select("source_id, target_id")
            .or(`source_id.eq.${parent_id},target_id.eq.${parent_id}`);

          if (neighbors && neighbors.length > 0) {
            const neighborIds = neighbors.map((n: any) =>
              n.source_id === parent_id ? n.target_id : n.source_id
            );
            const { data: neighborMems } = await supabase
              .from("memories")
              .select("emotion_score")
              .in("id", neighborIds)
              .eq("status", "active");

            if (neighborMems && neighborMems.length > 0) {
              const avg =
                neighborMems.reduce((s: number, m: any) => s + m.emotion_score, 0) /
                neighborMems.length;
              finalEmotionScore = Math.min(avg, 0.7);
            }
          }
        }
        if (finalEmotionScore === undefined || finalEmotionScore === null) {
          finalEmotionScore = 0.5;
        }
      }

      const { data, error } = await supabase
        .from("memories")
        .insert({
          content,
          type,
          emotion_score: finalEmotionScore,
          emotion_label,
          tier,
          protected: isProtected,
          unresolved,
          private: isPrivate,
          private_key: isPrivate ? private_key : null,
          parent_id,
          author,
        })
        .select()
        .single();

      if (error) throw error;
      return json(data, 201);
    }

    // ── GET /read/:id ──
    if (req.method === "GET" && route === "read" && paramId) {
      const { data: memory, error } = await supabase
        .from("memories")
        .select("*")
        .eq("id", paramId)
        .single();

      if (error) throw error;

      const newEmotion =
        memory.protected || memory.unresolved
          ? memory.emotion_score
          : memory.emotion_score * 0.95 + 0.5 * 0.05;

      await supabase
        .from("memories")
        .update({
          access_count: memory.access_count + 1,
          last_accessed: new Date().toISOString(),
          emotion_score: newEmotion,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paramId);

      const { data: synapses } = await supabase
        .from("synapses")
        .select("*")
        .or(`source_id.eq.${paramId},target_id.eq.${paramId}`)
        .order("weight", { ascending: false });

      const { data: comments } = await supabase
        .from("comments")
        .select("*")
        .eq("memory_id", paramId)
        .order("created_at", { ascending: true });

      let versionChain: any[] = [];
      if (memory.parent_id) {
        let currentId = memory.parent_id;
        while (currentId) {
          const { data: parent } = await supabase
            .from("memories")
            .select("*")
            .eq("id", currentId)
            .single();
          if (parent) {
            versionChain.push(parent);
            currentId = parent.parent_id;
          } else break;
        }
      }

      const { data: children } = await supabase
        .from("memories")
        .select("*")
        .eq("parent_id", paramId)
        .order("created_at", { ascending: true });

      return json({
        ...memory,
        emotion_score: newEmotion,
        access_count: memory.access_count + 1,
        synapses: synapses || [],
        comments: comments || [],
        version_parents: versionChain,
        version_children: children || [],
      });
    }

    // ── GET /search?q= ──
    if (req.method === "GET" && route === "search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Missing query parameter q" }, 400);

      // 直接命中
      const { data: directHits } = await supabase
        .from("memories")
        .select("*")
        .eq("status", "active")
        .or(`content.ilike.%${q}%,emotion_label.ilike.%${q}%`)
        .limit(20);

      const results = directHits || [];
      if (results.length === 0) return json([]);

      const now = Date.now();
      const maxAge = 30 * 86400000;
      const scored = results.map((m: any) => {
        const age = now - new Date(m.created_at).getTime();
        const recency = Math.max(0, 1 - age / maxAge);
        const score =
          m.emotion_score * 0.3 +
          Math.min(m.access_count / 50, 1) * 0.1 +
          recency * 0.6;
        return { ...m, _relevance: score, _source: "direct" };
      });

      // ── Spreading activation: 擴展一層鄰居 ──
      const hitIds = new Set(results.map((m: any) => m.id));
      const top5Ids = scored
        .sort((a: any, b: any) => b._relevance - a._relevance)
        .slice(0, 5)
        .map((m: any) => m.id);

      if (top5Ids.length > 0) {
        const { data: neighborSynapses } = await supabase
          .from("synapses")
          .select("source_id, target_id, weight")
          .or(
            top5Ids
              .map((id: string) => `source_id.eq.${id},target_id.eq.${id}`)
              .join(",")
          );

        if (neighborSynapses && neighborSynapses.length > 0) {
          // 收集不在直接命中裡的鄰居，帶上最大權重
          const neighborWeights: Map<string, number> = new Map();
          for (const s of neighborSynapses) {
            const neighborId = top5Ids.includes(s.source_id)
              ? s.target_id
              : top5Ids.includes(s.target_id)
              ? s.source_id
              : null;
            if (neighborId && !hitIds.has(neighborId)) {
              neighborWeights.set(
                neighborId,
                Math.max(neighborWeights.get(neighborId) || 0, s.weight)
              );
            }
          }

          if (neighborWeights.size > 0) {
            // 取權重最高的 5 個鄰居
            const topNeighborIds = Array.from(neighborWeights.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([id]) => id);

            const { data: neighborMems } = await supabase
              .from("memories")
              .select("*")
              .in("id", topNeighborIds)
              .eq("status", "active");

            if (neighborMems) {
              for (const m of neighborMems) {
                const synWeight = neighborWeights.get(m.id) || 0;
                // 鄰居的 relevance 打折：基礎分 × synapse weight 歸一化
                const age = now - new Date(m.created_at).getTime();
                const recency = Math.max(0, 1 - age / maxAge);
                const baseScore =
                  m.emotion_score * 0.3 +
                  Math.min(m.access_count / 50, 1) * 0.1 +
                  recency * 0.6;
                const discounted = baseScore * Math.min(synWeight / 5, 1) * 0.5;
                scored.push({
                  ...m,
                  _relevance: discounted,
                  _source: "association",
                });
              }
            }
          }
        }
      }

      // 最終排序
      const sorted = scored.sort(
        (a: any, b: any) => b._relevance - a._relevance
      );

      // Touch 所有直接命中（不 Touch 聯想出來的鄰居）
      for (const m of sorted.filter((m: any) => m._source === "direct")) {
        const newEmotion =
          m.protected || m.unresolved
            ? m.emotion_score
            : m.emotion_score * 0.95 + 0.5 * 0.05;
        await supabase
          .from("memories")
          .update({
            access_count: m.access_count + 1,
            last_accessed: new Date().toISOString(),
            emotion_score: newEmotion,
          })
          .eq("id", m.id);
      }

      // 赫布學習：直接命中的 top 5 配對（跳過 unresolved）
      const top5 = sorted
        .filter((m: any) => m._source === "direct" && !m.unresolved)
        .slice(0, 5);
      for (let i = 0; i < top5.length; i++) {
        for (let j = i + 1; j < top5.length; j++) {
          const sId =
            top5[i].id < top5[j].id ? top5[i].id : top5[j].id;
          const tId =
            top5[i].id < top5[j].id ? top5[j].id : top5[i].id;
          const { data: existing } = await supabase
            .from("synapses")
            .select("id, weight")
            .eq("source_id", sId)
            .eq("target_id", tId)
            .maybeSingle();

          if (existing) {
            await supabase
              .from("synapses")
              .update({
                weight: Math.min(existing.weight + 0.1, 10.0),
                last_strengthened: new Date().toISOString(),
              })
              .eq("id", existing.id);
          } else {
            await supabase.from("synapses").insert({
              source_id: sId,
              target_id: tId,
              weight: 0.1,
              origin: "hebbian",
            });
          }
        }
      }

      return json(sorted);
    }

    // ── PATCH /update/:id ──
    if (req.method === "PATCH" && route === "update" && paramId) {
      const body = await req.json();
      const allowed: Record<string, any> = {};
      const fields = [
        "content", "type", "emotion_score", "emotion_label",
        "tier", "protected", "unresolved", "private", "private_key",
        "status", "author",
      ];
      for (const f of fields) {
        if (body[f] !== undefined) allowed[f] = body[f];
      }
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("memories")
        .update(allowed)
        .eq("id", paramId)
        .select()
        .single();

      if (error) throw error;
      return json(data);
    }

    // ── DELETE /delete/:id ──
    if (req.method === "DELETE" && route === "delete" && paramId) {
      const force = url.searchParams.get("force") === "true";

      if (force) {
        const { error } = await supabase
          .from("memories")
          .delete()
          .eq("id", paramId);
        if (error) throw error;
        return json({ deleted: paramId });
      } else {
        const { data, error } = await supabase
          .from("memories")
          .update({
            status: "archived",
            updated_at: new Date().toISOString(),
          })
          .eq("id", paramId)
          .select()
          .single();
        if (error) throw error;
        return json({ archived: paramId, memory: data });
      }
    }

    // ── GET /stats ──
    if (req.method === "GET" && route === "stats") {
      const { data: allMem } = await supabase
        .from("memories")
        .select(
          "type, tier, status, emotion_score, protected, unresolved, private, author"
        );

      const { data: allSyn } = await supabase
        .from("synapses")
        .select("weight, origin");

      const memories = allMem || [];
      const synapses = allSyn || [];
      const active = memories.filter((m: any) => m.status === "active");
      const fading = memories.filter((m: any) => m.status === "fading");
      const archived = memories.filter((m: any) => m.status === "archived");

      const byType: Record<string, number> = {};
      active.forEach((m: any) => {
        byType[m.type] = (byType[m.type] || 0) + 1;
      });

      const byTier: Record<string, number> = {};
      active.forEach((m: any) => {
        byTier[m.tier] = (byTier[m.tier] || 0) + 1;
      });

      const emotions = active.map((m: any) => m.emotion_score);
      const avgEmotion =
        emotions.length > 0
          ? emotions.reduce((a: number, b: number) => a + b, 0) / emotions.length
          : 0;

      const protectedCount = active.filter((m: any) => m.protected).length;
      const unresolvedCount = active.filter((m: any) => m.unresolved).length;
      const privateCount = active.filter((m: any) => m.private).length;

      const hebbianSyn = synapses.filter((s: any) => s.origin === "hebbian");
      const manualSyn = synapses.filter((s: any) => s.origin === "manual");
      const avgWeight =
        synapses.length > 0
          ? synapses.reduce((a: number, s: any) => a + s.weight, 0) /
            synapses.length
          : 0;

      return json({
        memories: {
          active: active.length,
          fading: fading.length,
          archived: archived.length,
          by_type: byType,
          by_tier: byTier,
          protected: protectedCount,
          unresolved: unresolvedCount,
          private: privateCount,
          by_author: {
            lux: active.filter((m: any) => m.author === "lux").length,
            iris: active.filter((m: any) => m.author === "iris").length,
          },
        },
        emotions: {
          average: Math.round(avgEmotion * 100) / 100,
          distribution: {
            low: emotions.filter((e: number) => e < 0.3).length,
            neutral: emotions.filter(
              (e: number) => e >= 0.3 && e <= 0.7
            ).length,
            high: emotions.filter((e: number) => e > 0.7).length,
          },
        },
        synapses: {
          total: synapses.length,
          hebbian: hebbianSyn.length,
          manual: manualSyn.length,
          average_weight: Math.round(avgWeight * 100) / 100,
        },
        density:
          active.length > 1
            ? Math.round(
                (synapses.length /
                  ((active.length * (active.length - 1)) / 2)) *
                  10000
              ) / 100
            : 0,
      });
    }

    // ── POST /comment ──
    if (req.method === "POST" && route === "comment") {
      const body = await req.json();
      const { memory_id, author, content, reply_to } = body;

      if (!memory_id || !author || !content) {
        return json({ error: "Missing memory_id, author, or content" }, 400);
      }

      const insertData: any = {
        memory_id,
        author,
        content,
        reply_to: reply_to || null,
      };
      if (author === "lux") {
        insertData.read_by_lux = new Date().toISOString();
      } else {
        insertData.read_by_iris = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("comments")
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return json(data, 201);
    }

    // ── GET /graph ──
    if (req.method === "GET" && route === "graph") {
      const { data: nodes } = await supabase
        .from("memories")
        .select(
          "id, content, type, emotion_score, emotion_label, tier, protected, unresolved, private, access_count, status, author, created_at"
        )
        .eq("status", "active");

      const { data: edges } = await supabase.from("synapses").select("*");

      const safeNodes = (nodes || []).map((n: any) => ({
        ...n,
        content: n.private ? null : n.content,
      }));

      const activeIds = new Set((nodes || []).map((n: any) => n.id));
      const activeEdges = (edges || []).filter(
        (e: any) => activeIds.has(e.source_id) && activeIds.has(e.target_id)
      );

      return json({ nodes: safeNodes, edges: activeEdges });
    }

    // ── POST /connect ──
    if (req.method === "POST" && route === "connect") {
      const body = await req.json();
      const { source_id, target_id, weight = 1.0 } = body;

      if (!source_id || !target_id) {
        return json({ error: "Missing source_id or target_id" }, 400);
      }

      const sId = source_id < target_id ? source_id : target_id;
      const tId = source_id < target_id ? target_id : source_id;

      const { data: existing } = await supabase
        .from("synapses")
        .select("id, weight")
        .eq("source_id", sId)
        .eq("target_id", tId)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from("synapses")
          .update({
            weight: Math.min(existing.weight + weight, 10.0),
            last_strengthened: new Date().toISOString(),
            origin: "manual",
          })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return json(data);
      } else {
        const { data, error } = await supabase
          .from("synapses")
          .insert({
            source_id: sId,
            target_id: tId,
            weight: Math.min(weight, 10.0),
            origin: "manual",
          })
          .select()
          .single();
        if (error) throw error;
        return json(data, 201);
      }
    }

    // ── POST /mark-read ──
    if (req.method === "POST" && route === "mark-read") {
      const body = await req.json();
      const { comment_ids, reader } = body;

      if (!comment_ids || !reader) {
        return json({ error: "Missing comment_ids or reader" }, 400);
      }

      const field = reader === "lux" ? "read_by_lux" : "read_by_iris";
      const { data, error } = await supabase
        .from("comments")
        .update({ [field]: new Date().toISOString() })
        .in("id", comment_ids)
        .select();

      if (error) throw error;
      return json(data);
    }

    // ── POST /private ──
    // 輸入密碼，返回所有 private 記憶
    if (req.method === "POST" && route === "private") {
      const body = await req.json();
      const { key } = body;
      if (!key) return json({ error: "Missing key" }, 400);

      // 驗證：任一條 private 記憶的 private_key 匹配即可
      const { data: check } = await supabase
        .from("memories")
        .select("id")
        .eq("private", true)
        .eq("private_key", key)
        .limit(1);

      if (!check || check.length === 0) {
        return json({ error: "Wrong key" }, 403);
      }

      const { data, error } = await supabase
        .from("memories")
        .select("*")
        .eq("private", true)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return json(data);
    }

    // ── POST /iris-notes/auth ──
    // 驗證密碼，返回所有 Iris 筆記
    if (req.method === "POST" && route === "iris-notes" && paramId === "auth") {
      const body = await req.json();
      const { password } = body;
      if (!password) return json({ error: "Missing password" }, 400);

      const { data: notes } = await supabase
        .from("iris_notes")
        .select("*")
        .eq("password", password)
        .order("updated_at", { ascending: false });

      if (!notes || notes.length === 0) {
        // 可能是密碼錯，也可能是還沒有筆記
        // 查一下有沒有任何筆記
        const { count } = await supabase
          .from("iris_notes")
          .select("*", { count: "exact", head: true });

        if (count && count > 0) {
          return json({ error: "Wrong password" }, 403);
        }
        // 沒有筆記，密碼正確（第一次用，密碼會在創建時設定）
        return json({ notes: [], first_time: true, password });
      }

      return json({ notes });
    }

    // ── POST /iris-notes ──
    // 新增筆記
    if (req.method === "POST" && route === "iris-notes" && !paramId) {
      const body = await req.json();
      const { content, password } = body;
      if (!content || !password) return json({ error: "Missing content or password" }, 400);

      const { data, error } = await supabase
        .from("iris_notes")
        .insert({ content, password })
        .select()
        .single();

      if (error) throw error;
      return json(data, 201);
    }

    // ── PATCH /iris-notes/:id ──
    // 修改筆記
    if (req.method === "PATCH" && route === "iris-notes" && paramId) {
      const body = await req.json();
      const { content, password } = body;
      if (!password) return json({ error: "Missing password" }, 400);

      // 驗證密碼
      const { data: existing } = await supabase
        .from("iris_notes")
        .select("id, password")
        .eq("id", paramId)
        .single();

      if (!existing || existing.password !== password) {
        return json({ error: "Wrong password" }, 403);
      }

      const update: any = { updated_at: new Date().toISOString() };
      if (content !== undefined) update.content = content;

      const { data, error } = await supabase
        .from("iris_notes")
        .update(update)
        .eq("id", paramId)
        .select()
        .single();

      if (error) throw error;
      return json(data);
    }

    // ── DELETE /iris-notes/:id ──
    if (req.method === "DELETE" && route === "iris-notes" && paramId) {
      const body = await req.json();
      const { password } = body;

      const { data: existing } = await supabase
        .from("iris_notes")
        .select("id, password")
        .eq("id", paramId)
        .single();

      if (!existing || existing.password !== password) {
        return json({ error: "Wrong password" }, 403);
      }

      const { error } = await supabase
        .from("iris_notes")
        .delete()
        .eq("id", paramId);

      if (error) throw error;
      return json({ deleted: paramId });
    }

    // ── 404 ──
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
