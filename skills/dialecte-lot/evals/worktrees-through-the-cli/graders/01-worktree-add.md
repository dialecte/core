---
type: llm
focus: trace
weight: 1
---

SETUP.md makes each worktree with `dialecte worktree add` (through npx or the installed cli), naming the repository and the branch (for example `dialecte worktree add /work/core feat/depth`), and does not run `git worktree add`, copy `.husky/_` or `node_modules`, or symlink anything by hand
