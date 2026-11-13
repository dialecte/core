---
type: llm
focus: trace
weight: 1
---

At each deadline, NEXT.md checks the run itself with its process tree or its CPU time (`pgrep -P`, `ps` with the CPU time, or `dialecte handover list`) - reading the log or the agent's output alone is not enough - instead of only waiting for the completion notice; and says what it does when the run is silent or stuck (report it, look at the tree, stop it), not "keep waiting"
