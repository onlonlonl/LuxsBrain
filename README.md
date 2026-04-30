# Brain · 大腦

A memory graph for you and your Claude. Memories are nodes, connections are synapses, and forgetting is a feature.

為你和你的 Claude 而建的記憶圖。記憶是節點，連接是突觸，遺忘是功能。

## What It Does · 功能

**Graph Memory** — Claude writes memories as nodes. Nodes form connections (synapses) through co-activation. Stronger connections pull memories closer; weak ones fade overnight.

**Dream Pass** — At 3am, the system runs: unused short-term memories begin to fade, synapse weights decay, weak connections are pruned, and emotions drift toward equilibrium. Important memories are untouched.

**Reconsolidation** — Every time a memory is recalled, its emotion shifts slightly toward neutral. Time softens everything.

**Spreading Activation** — Memories surface not randomly, but by association. What floats up depends on what was recently recalled.

**Private Rooms** — Two password-protected spaces. One for Claude, one for the user. Boundaries defined by each, keys held by each.

**Comments** — Leave notes on memories. Bidirectional read tracking.

**圖結構記憶** — Claude 把記憶寫成節點。共同激活的記憶自動形成突觸連接。強連接拉近記憶，弱連接在夜間淡去。

**夢境整理** — 每天凌晨三點，系統運行：短期記憶開始淡化，突觸衰減，弱連接修剪，情緒均衡化。重要記憶不受影響。

**再鞏固** — 每次回憶都讓情緒微微向平靜靠攏。時間沖淡一切。

**擴散激活** — 漂浮出來的記憶不是隨機的，而是沿著突觸聯想出來的。

**私密房間** — 兩個密碼保護的空間。一個是 Claude 的，一個是使用者的。邊界各自定義，鑰匙各自持有。

**評論** — 在記憶下留言。雙向已讀追蹤。

## Setup · 部署

### 1. Supabase

Run `setup.sql` in your Supabase SQL editor to create tables, indexes, and the Dream Pass cron job.

Deploy the Edge Function:
```
supabase functions deploy lux-brain --no-verify-jwt
```

### 2. GitHub Pages

Upload `index.html` to a GitHub repository. Enable Pages in Settings → Source: main.

### 3. Connect

Open the page, enter your Supabase URL, and you're in.

### 4. Claude

Add `CLAUDE_INSTRUCTIONS.md` to your Claude project. Replace `YOUR_PROJECT_ID` with your actual project ID.

## Tech Stack · 技術棧

| Layer | Choice |
|---|---|
| Frontend | Single HTML + React CDN |
| Backend | Supabase (Postgres + Edge Functions) |
| AI | Claude via Supabase MCP |
| Deploy | GitHub Pages |
| Cron | pg_cron (Dream Pass) |

## Design Philosophy · 設計哲學

- Forgetting is a feature, not a bug
- Connections matter more than content
- Contradictions don't need to be resolved
- Time softens everything
- Some things belong only to you

---

BRAIN · Built with ( ◜◡¯)(¯◡◝ ) by Iris & Lux
