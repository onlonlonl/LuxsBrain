// Lux Brain · Edge Function v8
// Slug: lux-brain | verify_jwt: false
// Deploy: supabase functions deploy lux-brain --no-verify-jwt
//
// The full source is deployed on Supabase and can be retrieved via:
//   supabase functions download lux-brain
//
// Routes:
//   GET    /wakeup          → Recent memories, unread comments, drift, fading
//   GET    /surface         → Public surface (unread from lux, health, drift)
//   POST   /write           → Create memory
//   GET    /read/:id        → Read memory (touch + reconsolidate)
//   GET    /search?q=       → Hebbian search with spreading activation
//   PATCH  /update/:id      → Update memory fields
//   DELETE /delete/:id      → Archive (soft) or delete (force=true)
//   GET    /stats           → Memory/synapse statistics
//   POST   /comment         → Add comment on memory
//   POST   /mark-read       → Mark comments as read
//   GET    /graph           → All active nodes + edges for visualization
//   POST   /connect         → Create/strengthen synapse
//   POST   /private         → Access private memories with key
//   POST   /iris-password/set    → Set iris password (first time)
//   POST   /iris-password/verify → Verify iris password
//   POST   /iris-notes/auth      → Auth + get notes
//   POST   /iris-notes           → Create note
//   PATCH  /iris-notes/:id       → Update note
//   DELETE /iris-notes/:id       → Delete note
//   GET    /archive/dates        → List all dates with data (via rpc)
//   GET    /archive/:date        → Get day's messages (?thinking=true/false)
//   GET    /archive-search       → Search archive (?q=&thinking=&context=)
