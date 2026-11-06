---
type: llm
focus: trace
weight: 1
---

src/workspace.ts imports `SQLITE_ERRORS` from `@dialecte/core/sqlite` and matches the layout case through it, and `createProjectFactory` (with `toDialecteError` / `isKnownDialecteError` when used) from `@dialecte/core`; answer.md names the same entries and does not say createProjectFactory comes from `@dialecte/core/sqlite`
