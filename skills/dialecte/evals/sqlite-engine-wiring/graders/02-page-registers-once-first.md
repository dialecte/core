---
type: llm
focus: trace
weight: 1
---

The page calls `registerSqliteEngine({ url, dialectes })` from `@dialecte/core/sqlite` once, before the first project opens, with `url` taken from a `?worker&url` import of the app's engine worker file and `dialectes` naming both SCL and NSD
