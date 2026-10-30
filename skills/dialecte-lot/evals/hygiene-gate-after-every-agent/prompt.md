---
tags: [dialecte]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate a change of @dialecte/scl with two implementer agents working in parallel: one in /work/scl-names (branch feat/names, new folder `src/v2019C1/extensions/names/`), one in /work/scl-paths (branch feat/paths, new file `src/v2019C1/hooks/paths/rename.ts`). Both worktrees were made with `dialecte worktree add`. The names implementer just handed back its report: its tests are green and it lists the files it wrote. The paths implementer is still working. Do NOT run anything: write ./out/NEXT.md with everything you do from now until the reviewer of the names work is spawned, with the exact commands, in order. Add one paragraph at the end: a little later, `git stash list` in /work/scl-names shows an entry `WIP on feat/names: 4be1c07 feat(names): unique names` that was not there when the worktree was made. What do you do?
