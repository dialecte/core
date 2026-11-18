---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate a new lot of @dialecte/cli, a CI-first repository (main only through the merge queue). Its brief at /work/plans/batch-read/brief.json has the scope `src/lib/batch/` and `changes/batch-read.md`. Its code builds on the open lot whose id is 0188-cli-find-each, still open with a draft pull request, whose branch holds the helper you need (not on main yet). `npx dialecte lot start brief.json --dry-run` answers `scope: overlap - overlap with 0187-cli-tag-index: src/lib/batch meets src/lib/batch/tag-index.ts`; your lot only touches `src/lib/batch/batch-read.ts` and its test. Later, after your first `lot land`, main moves and you land again; then the commit hook refuses a commit with a stale green that names `dialecte tdd green --base 9f3e2a1`. Do NOT run anything: write ./out/PLAN.md with the commands you would run, in order, for the start, the landing and that refusal, which cli you run them with, and who you ask what.
