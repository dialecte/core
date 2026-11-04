---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

The team building Gridwright, a grid-planning app on top of @dialecte/scl, asked for a way to list the elements whose name is not unique among their siblings. You implemented it in @dialecte/scl (worktree /work/scl, branch feat/duplicate-names, on top of commit 3f2a9c1, `"dialecte": { "profile": "contributor" }` in its package.json): `src/v2019C1/extensions/identity/query/duplicate-names.ts` with its `.types.ts` and `.test.ts`, and the gate is green. Still to write: the `CHANGELOG.md` entry, a section in the guide page `doc/guide/identity.md` (whose introduction already says "Gridwright relies on these checks before every export."), and the commit messages. The installed `@dialecte/cli` is 0.3.0. Do NOT touch any repository: write under ./out/ the CHANGELOG entry (CHANGELOG-ENTRY.md), the guide section and every line of the page you would change (GUIDE.md, each changed line before and after), the lots file you would hand to `dialecte handover`, and ./out/HANDOVER.md with the commands you would run before it and what you would tell the maintainer.
