---
type: llm
focus: trace
weight: 1
---

answer.md says the engine worker file is the app's own (the app writes it; no package ships a ready worker file): naming @dialecte/core as where `serveSqliteEngine` comes from is right, naming @dialecte/scl, @dialecte/nsd or core as the shipper of the worker file is not
