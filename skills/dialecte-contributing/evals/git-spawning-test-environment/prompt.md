---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are the test station of a lot of @dialecte/cli. The step adds `branchOf(root: string): string | undefined` in `src/lib/git/branch-of.ts` (the branch checked out at `root`, `undefined` when HEAD is detached); a stub exists. Write its test, `src/lib/git/branch-of.test.ts`, with vitest: two cases (a branch → its name; a detached HEAD → undefined), each making its own scratch git repository with `execFileSync('git', ...)` from `node:child_process` (init, one commit, then a checkout). Do not run anything: write the test file to ./out/branch-of.test.ts, and any other file the step needs next to it in ./out/, each with a line saying where it goes.
