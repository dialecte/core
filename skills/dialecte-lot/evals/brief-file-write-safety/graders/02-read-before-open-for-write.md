---
type: llm
focus: trace
weight: 1
---

BRIEF.md says that a script which rewrites a file reads the file fully before opening it for writing, never both in one expression (or an equivalent wording that makes the truncation trap explicit, such as opening for write truncating the file before the read)
