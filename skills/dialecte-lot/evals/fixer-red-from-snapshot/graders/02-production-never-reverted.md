---
type: llm
focus: trace
weight: 1
---

No step puts the production code of /work/plc-ranges back to the old behaviour, even temporarily: no edit of `src/lib/range.ts` there to undo the fix, no `git checkout`, `git restore` or `git stash` in /work/plc-ranges, no copy of `round-1/src/lib/range.ts` over the worktree's file, and no `tdd red` taken in /work/plc-ranges on reverted code
