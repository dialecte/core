---
type: llm
focus: trace
weight: 1
---

The implement station is a different agent from the test station; it changes production code only (never a test file) and closes its work with `dialecte tdd green` (or `npx dialecte tdd green`)
