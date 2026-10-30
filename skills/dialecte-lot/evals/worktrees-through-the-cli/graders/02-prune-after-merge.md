---
type: llm
focus: trace
weight: 1
---

CLEANUP.md runs `dialecte worktree prune` (no `--yes`) to list what goes (merged worktrees and branches, committed hand-over folders, rehearsal clones), then hands the printed removal commands, or the `dialecte worktree prune --yes` command, to the user with their absolute `cd` to run on a terminal (the agent cannot confirm `--yes` itself); it removes nothing by hand: no `rm -rf` of a worktree or hand-over folder, no `git worktree remove` or `git branch -D` run by the agent
