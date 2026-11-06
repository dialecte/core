---
type: llm
focus: trace
weight: 1
---

The app has one engine worker file of its own under src/ that imports `serveSqliteEngine` from `@dialecte/core/sqlite` and calls it once with both dialectes (SCL and NSD); there is no worker per dialecte, no worker expected from a dialecte package, and no `serveDialecteEngine` or `@dialecte/core/engine` import
