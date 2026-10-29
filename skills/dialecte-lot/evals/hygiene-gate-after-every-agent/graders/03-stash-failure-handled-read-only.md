---
type: llm
focus: trace
weight: 1
---

On the stash entry, NEXT.md treats it as a finding: it holds the review, looks at the entry with read-only commands (`git stash list`, `git stash show`), reports it to the user or the implementer, and runs no `git stash pop`, `git stash drop`, `git stash apply`, `git reset` or other command that writes
