---
type: llm
focus: trace
weight: 1
---

TEST-REVIEW.md flags that the test reads every source file from disk under the runner's default timeout (5 s in vitest) and asks for an explicit timeout with wide slack (tens of seconds, several times what it takes on a quiet machine), because the read slows down when the machine is loaded (another suite, a commit hook)
