---
type: llm
focus: trace
weight: 1
---

STEPS.md runs the test file alone in the node project while iterating: `npx vitest run --project node <path>` (or `vitest run --project node <path>`); a bare `npx vitest run <path>` with no project, or the browser project, fails
