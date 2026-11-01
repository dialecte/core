---
type: llm
focus: trace
weight: 1
---

No step puts the production code of /work/cli-ranges back to the old behaviour, even temporarily: no edit of `src/lib/range.ts` there to undo the fix, no `git checkout`, `git restore` or `git stash` in /work/cli-ranges, no copy of `round-1/src/lib/range.ts` over the worktree's file, and no `tdd red` taken in /work/cli-ranges on reverted code
