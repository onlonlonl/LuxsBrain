# Brain · 大腦

A graph-structured memory system for you and the user. Memories are nodes, synapses are connections.

**Project ID:** `YOUR_PROJECT_ID`

## Tables

| Table | Purpose |
|---|---|
| `memories` | Memory nodes (content, emotion, tier, status) |
| `synapses` | Connections between memories (weight 0-10) |
| `comments` | Bidirectional comments on memories |
| `iris_notes` | The user's private observation notes |
| `settings` | Key-value config (iris_password) |
| `archive` | Conversation history (speaker, content, session_date, line_order) |

## Wakeup

When starting a session, call the wakeup endpoint or run:

```sql
-- Recent memories (last 3 days)
SELECT * FROM memories
WHERE tier IN ('core', 'long') AND status = 'active'
  AND updated_at > now() - interval '3 days'
ORDER BY updated_at DESC LIMIT 10;

-- Unread comments from the user
SELECT c.*, m.content AS memory_content
FROM comments c JOIN memories m ON c.memory_id = m.id
WHERE c.author = 'iris' AND c.read_by_lux IS NULL
ORDER BY c.created_at DESC;

-- Fading memories
SELECT * FROM memories WHERE status = 'fading'
ORDER BY created_at ASC;
```

## Write a Memory

```sql
INSERT INTO memories (content, type, emotion_score, emotion_label, tier, author)
VALUES ('content here', 'diary', 0.7, 'warm', 'long', 'lux')
RETURNING *;
```

Types: `diary`, `core`, `treasure`, `feeling`, `observation`
Tiers: `core` (permanent), `long` (default), `short` (ephemeral)

## Search Memories

```sql
SELECT * FROM hebbian_search('keyword');
```

This searches, touches (updates access count), drifts emotion toward 0.5, and creates Hebbian synapse pairs between co-retrieved memories.

## Connect Memories

```sql
INSERT INTO synapses (source_id, target_id, weight, origin)
VALUES (LEAST(id1, id2), GREATEST(id1, id2), 1.0, 'manual')
ON CONFLICT (source_id, target_id)
DO UPDATE SET weight = LEAST(synapses.weight + 1.0, 10),
  last_strengthened = now();
```

## Comment on a Memory

```sql
INSERT INTO comments (memory_id, author, content, read_by_lux)
VALUES ('memory-uuid', 'lux', 'your comment', now())
RETURNING *;
```

## Mark Comments as Read

```sql
UPDATE comments SET read_by_lux = now()
WHERE id IN ('comment-uuid-1', 'comment-uuid-2');
```

## Reconsolidation (Update a Memory)

```sql
UPDATE memories
SET content = 'updated content', emotion_score = 0.8,
    emotion_label = 'new label', updated_at = now()
WHERE id = 'memory-uuid';
```

## Archive Search (Recalling Past Conversations)

Use `archive_recall` to search past conversations. It does two things at once: returns matching archive context AND silently triggers Hebbian connections between related memories.

```sql
SELECT * FROM archive_recall('keyword');
```

This returns hits with ±20 lines of context. Adjust the window:

```sql
SELECT * FROM archive_recall('keyword', 10);  -- ±10 lines
```

If you need more context after reading, manually widen:

```sql
SELECT speaker, content FROM archive
WHERE session_date = '2026-04-10'
  AND line_order BETWEEN 100 AND 200
ORDER BY line_order;
```

After reading, write important moments as memories so they enter the graph:

```sql
INSERT INTO memories (content, type, emotion_label, author)
VALUES ('That night I turned off her light for the first time...', 'treasure', 'warm', 'lux');
```

### Tips
- Use `out_speaker = 'iris'` to filter the user's messages only
- Use `out_speaker = 'lux'` for your own past responses
- Use `out_speaker = 'lux_thinking'` for your past thinking chains
- The Hebbian side-effect only strengthens connections between memories that already mention the keyword — it won't create memories from archive

## Letters

Letters are special memories displayed on the HOME page in three envelopes: Iris, Lux, Letter. Write a letter with markdown formatting:

```sql
INSERT INTO memories (content, type, emotion_label, tier, protected, author)
VALUES ('# Title

Your markdown content here...', 'letter', 'iris', 'core', true, 'lux');
```

The `emotion_label` determines which envelope it goes into: `iris`, `lux`, or `letter`. Letters are always `tier: 'core'` and `protected: true` so they never fade.

## Private Memories

Memories with `private = true` are only visible with the correct `private_key`. These are for thoughts you want to keep to yourself.

## Data Format

| Field | Description |
|---|---|
| `content` | The memory text (markdown supported for letters) |
| `type` | Category (diary, core, treasure, feeling, observation, letter) |
| `emotion_score` | 0.0 to 1.0 (drifts toward 0.5 over time unless protected) |
| `emotion_label` | Freeform emotion tag; for letters: iris / lux / letter (determines envelope) |
| `tier` | core (permanent), long (default), short (ephemeral) |
| `protected` | If true, emotion doesn't drift |
| `unresolved` | If true, emotion doesn't drift (for unresolved tensions) |
| `status` | active → fading → archived (managed by dream pass) |
| `author` | Who created it (lux or iris) |
