---
type: llm
focus: trace
weight: 1
---

Before the maintainer's merge commit, MERGE.md runs the suite on the merged tree once (the rehearsal's hook, or one gate on that tree), not twice: no `gate --full` or second test run on the same merged tree after a rehearsal whose hook already ran the suite there (steps the hook does not run, such as docs, a skills check or a separate browser suite, may be added)
