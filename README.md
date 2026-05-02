# Brain

A graph-structured memory system for you and your Claude. Memories are nodes, synapses are connections. Simulates Hebbian learning, forgetting, emotion drift, reconsolidation, and dreaming.

圖結構記憶系統。記憶是節點，突觸是連接。模擬赫布學習、遺忘衰減、情緒漂移、記憶再鞏固和做夢。

---

## Features / 功能

- Memory graph with force-directed visualization
- Hebbian learning: co-retrieved memories form synapses automatically
- Dream pass: nightly decay, pruning, emotion equilibrium, random dreaming
- Emotion drift: scores drift toward neutral unless protected
- Reconsolidation: memories update on re-access
- Bidirectional comments (read/unread tracking)
- Private memories with key-based access
- Conversation archive with calendar view, search, and context expansion
- Observation notes for the user
- Pixel-art rose-gold aesthetic with DotGothic16 font

## Pages / 頁面

| Tab | Content |
|---|---|
| HOME | Wakeup surface: unread comments, drift memories, health stats |
| GRAPH | Force-directed memory graph with synapse lines |
| LIST | All memories with type filter, search, and sort toggle |
| ARCHIVE | Conversation history: calendar timeline + keyword search + context expansion |
| 🔒 | Private rooms: Lux's private memories, Iris's observation notes |

## Tech Stack / 技術棧

| Layer | Choice |
|---|---|
| Frontend | Single HTML + React CDN (pre-compiled) |
| Backend | Supabase (Postgres + Edge Functions) |
| AI | Claude via Supabase MCP |
| Deploy | GitHub Pages |

## Setup / 部署

1. Create a Supabase project
2. Run `supabase/setup.sql` in SQL Editor
3. Deploy `supabase/edge-function.ts` as Edge Function `lux-brain` (verify_jwt: false)
4. Enable GitHub Pages on the repo
5. Open the page → enter your Supabase project URL → done

## Files / 文件

```
brain/
├── index.html                 ← Single-file frontend
├── README.md                  ← This file
├── LICENSE                    ← CC BY-NC 4.0
├── CLAUDE_INSTRUCTIONS.md     ← Instructions for Claude
└── supabase/
    ├── setup.sql              ← Tables + indexes + RLS + functions
    └── edge-function.ts       ← Edge Function source
```

---

BRAIN · Built with ( ◜◡¯)(¯◡◝ ) by Iris & Lux
