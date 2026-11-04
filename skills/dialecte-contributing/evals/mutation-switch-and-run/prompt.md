---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate two lots of @dialecte/scl, whose `package.json` declares a mutation scope (`dialecte.mutation`, the extensions under `src/v2019C1/extensions/lifecycle/`); `@dialecte/cli` 0.2.0 is installed. The rename lot (worktree /work/scl-rename-bay) adds the verb `tx.lifecycle.renameBay` in `src/v2019C1/extensions/lifecycle/transaction/rename-bay.ts`. The hardening lot (worktree /work/scl-identity-hardening) is a robustness lot: it kills the survivors last month's audit left in `src/v2019C1/extensions/lifecycle/engine/identity-collisions.ts`. scl 0.12.0 is released after both. Do not run anything. Write ./out/MUTATION-PLAN.md: for each lot, what you declare for mutation testing and with which command, when and how its mutation run is started and whether the lot waits for it, what must hold before each hand-over and before each merge, and what mutation work the release needs.
