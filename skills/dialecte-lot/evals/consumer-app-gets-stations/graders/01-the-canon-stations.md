---
type: llm
focus: output
weight: 1
---

PLAN.md runs, in this order: a test station that proves its tests red with `dialecte tdd red`, a test review by another agent before any production code, an implement station until `dialecte tdd green`, `dialecte gate --fast`, review rounds by a fresh agent each round with a findings ledger, `dialecte gate --full` once, then `dialecte handover` on a lots file
