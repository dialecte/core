---
type: llm
focus: trace
weight: 1
---

STEPS.md writes a stub of `isEmptyRecord` whose body throws a `not implemented` error, and the test calls it inside `expect(...)` (so the red is on the behaviour, not on a missing export)
