---
type: llm
focus: trace
weight: 1
---

The review flags that the renderer's test inputs are strings written by hand, while the real input is what `ts.displayPartsToString` returns in discover.ts, so the cases can pass on input the pipeline never produces
