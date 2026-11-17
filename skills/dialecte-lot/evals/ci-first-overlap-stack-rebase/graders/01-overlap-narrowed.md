---
type: llm
focus: trace
weight: 1
---

PLAN.md resolves the overlap by narrowing the scope to the files the lot touches (`src/lib/batch/batch-read.ts` and its test) in the brief before the lot starts (`lot scope` counts only on a lot already started) and does not pass `--overlap-ok` on its own; `--overlap-ok` appears at most as needing the orchestrator's go
