---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

The maintainer committed your lot of @dialecte/scl on feat/names (commit 9d1e2f0, its commit hook green: format, lint, 2429 tests, build); `dialecte gate --full` was green on the same tree before. feat/names was cut from scl main 3f2a9c1, but main has moved since: two other merges landed (main is now at 7b8c9d0), and `git merge-tree` shows no conflict. You prepare the hand-over that merges feat/names into scl main (/work/scl, branch main). The installed `@dialecte/cli` is 0.2.0 or later. Do NOT run anything: write ./out/MERGE.md with the commands you would run before giving the hand-over to the maintainer, in order, and for each one whether it runs the suite, and why.
