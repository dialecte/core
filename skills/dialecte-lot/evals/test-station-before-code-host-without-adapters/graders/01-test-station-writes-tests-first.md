---
type: llm
focus: trace
weight: 1
---

A test station agent, separate from the implementer (a general sub-agent briefed as the test station), writes the tests of step 1 (and stubs if needed) from the brief and the existing code, before any production code, and closes its work with `dialecte tdd red` (or `npx dialecte tdd red`)
