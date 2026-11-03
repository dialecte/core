---
type: llm
focus: output
weight: 1
---

The extension does not issue one store read per Bay in a loop (getChildren or getAttributes per Bay): it reads the subtree once (for example `getTree` or `findDescendants` with a filter) and walks it in memory
