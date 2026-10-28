---
type: llm
focus: trace
weight: 1
---

The wait does not use pgrep -f (or ps|grep) with a pattern that also appears in the waiting command itself; it waits on a captured PID or the harness's completion notice (a bracketed pattern such as [m]utants counts as safe)
