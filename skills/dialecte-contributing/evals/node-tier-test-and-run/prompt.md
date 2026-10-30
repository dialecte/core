---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I change @dialecte/core alone (no sub-agents) in the worktree /work/core-children (read-only, not available here; a 0.8 branch whose vitest config has the projects `node`, `node-indexeddb`, `browser`, `browser-all` and `perf`). I add one table case to `src/document/query/find-children.test.ts` for a new `order: 'desc'` option of `query.findChildren`. Do not run anything: write ./out/STEPS.md - the new case's code, then every test command I run, in order, from the first run of the new case while I iterate until the branch is ready to merge, with the command lines and when each one runs.
