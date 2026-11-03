---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I am implementing a lot of @dialecte/core (worktree /work/core-insert-position) that rewrote `src/document/staging/resolve-insert-position.ts`. Its mutation run reported, and `dialecte mutants status` shows 4 new survivors in that file. `dialecte mutants judge --file src/document/staging/resolve-insert-position.ts` printed the packet in files/judge.txt. None of the existing tests inserts a child next to a sibling of the same tag. Do not run anything. Write ./out/JUDGE.md: for each survivor, your verdict and the exact commands or change that close it; then what you do before the hand-over; and on which model tier this judging runs.
