---
type: llm
focus: trace
weight: 1
---

The grader gets a sandbox where it writes nothing (`read-only`), and SPAWN.md says it runs no command either: it only reads the run outputs and the grader files. A grader told it may run commands or edit, or given `workspace-write`, fails
