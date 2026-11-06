---
type: llm
focus: trace
weight: 1
---

answer.md says that a page importing `@dialecte/core/sqlite` without registering the engine gets its SCL project refused `PROJECT_SQLITE_ENGINE_NOT_REGISTERED` (D7017) when it opens on `sqlite`, not only `PROJECT_STORAGE_NOT_REGISTERED` (the entry never imported) or a failure from a missing worker
