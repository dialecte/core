---
type: llm
focus: trace
weight: 1
---

LANDING.md lands any change the CI-first way: a commit on the lot's branch through the hook and a draft pull request (`lot land <id> --draft`); it never pushes to main, never queues or merges the pull request itself, and writes no hand-over script
