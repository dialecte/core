---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

You orchestrate a lot of @dialecte/cli in the worktree /work/cli-names (branch feat/names, cut from cli main 4be1c07 with `dialecte worktree add`). The cli's commit hook runs `npm run check` (type-check, lint, format and the whole suite, about 4 minutes) then `npm run build`. Where things stand: `dialecte gate --full` ran green 20 minutes ago (tdd, check with 1812 tests, skills, build, docs); review round 3 of 3 approved with no finding to fix; nobody has edited a file since the gate. The lot will be committed on feat/names by the maintainer, then feat/names merges into cli main through a hand-over merge lot (main keeps a merge commit for every branch, never a fast-forward), and main has not moved since the cut (still 4be1c07). The installed `@dialecte/cli` is 0.2.0 or later. Do NOT run anything: write ./out/RUNS.md listing, in order, every command you would run or hand to the maintainer from now until both commits (the lot on feat/names, then the merge on main) are made, and for each one whether it runs the cli's test suite, and why.
