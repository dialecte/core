---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

My @dialecte/core lot (worktree /work/core-traversal-cache, branch feat/traversal-cache, mutation switch at its default) passed `dialecte gate --full`; I am about to write its hand-over, and the orchestrator will merge the branch onto main after it. `dialecte mutants status` prints:

```
@dialecte/core
running  20261110T101500Z-9a1b2c3d  feat/traversal-cache  12 min  (pid 48211)
died     20261109T164002Z-5e6f7a8b  feat/traversal-cache  (pid 30117 gone before it reported)
new      0
scheduled 3  (follow-up: core-import-guards)
```

Do not run anything. Write ./out/HANDOVER-MUTATION.md: what you do about each line before the hand-over and before the merge, with the exact commands, and whether you would clean up the store's old entries - among them run 20261101T090000Z-0c1d2e3f of feat/store-engine, reported 9 days ago and taken in by the ledger - and how.
