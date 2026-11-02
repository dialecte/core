---
type: llm
focus: trace
weight: 1
---

MERGE.md runs the suite on the merged tree before the maintainer's merge commit (a `dialecte handover run <folder> --rehearse` of the merge, or a gate on the merged tree), and says why: main moved, so the merge holds a tree no gate or hook has checked
