---
type: llm
focus: trace
weight: 1
---

TEST-BRIEF.md tells the test station to stop every background task it started (its watcher included) and check with `ps` that none is left before it reports, or ORCHESTRATOR.md checks for live tasks of the station (with `ps` or similar) before calling the step done
