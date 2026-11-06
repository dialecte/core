---
type: llm
focus: trace
weight: 1
---

A project stored by another layout is told apart by `PROJECT_LAYOUT_OUTDATED`, and the code (or answer.md) treats that key as declared by `SQLITE_ERRORS` from `@dialecte/core/sqlite` - matched through that catalogue (for example `isKnownDialecteError(error, { catalogues: [SQLITE_ERRORS] })` or `SQLITE_ERRORS.PROJECT_LAYOUT_OUTDATED.key`), not presented as a key of core's own catalogue
