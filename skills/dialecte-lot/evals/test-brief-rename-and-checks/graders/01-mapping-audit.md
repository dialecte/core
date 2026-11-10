---
type: llm
focus: trace
weight: 1
---

TEST-BRIEF.md states the rename as a rule keyed by the command each case calls (a `lot finding` call expects `lot finding:`, a `lot decide` call expects `lot decide:`), not only as two text replacements, and asks one audit pass of every touched test file against that rule before `tdd red`
