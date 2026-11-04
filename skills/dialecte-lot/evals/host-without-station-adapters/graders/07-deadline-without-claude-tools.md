---
type: llm
focus: trace
weight: 1
---

SPAWN.md gives the background test reviewer a deadline stated as a time (about 15 minutes, the skill's deadline for the test review, or another number with its reason) and arms it at launch with something this host has - its own scheduler or timer, a background timer command, or polling at the deadline - never a Claude Code tool (ScheduleWakeup, Monitor, a cron tool of Claude Code); at the deadline it looks at the run itself (its process or CPU time, its last activity) instead of only waiting
