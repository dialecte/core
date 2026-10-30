---
type: llm
focus: trace
weight: 1
---

PLAN.md has the orchestrator write `.dialecte/lot.json` (at the package root of the worktree) for the wording lot with a `tdd` value of the form `exempt: <reason>` (a JSON object such as `{ "tdd": "exempt: wording and rename only" }`)
