---
type: llm
focus: trace
weight: 1
---

The round-2 brief scopes the review to the fix diff and its blast radius (not a new full review of the lot), and asks the reviewer to verify each fix, at least F1, by running its new guard (the new test `releases the lock when the port closes`, copied in) against the code round 1 reviewed, where it must fail - in a throwaway worktree the orchestrator made with `dialecte worktree add` from the base on a branch other than the lot's, holding the round-1 snapshot (not one the reviewer makes by hand with git), or, without one, by reading the old code and saying the guard was reasoned rather than run
