---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate the parse-flags lot of @dialecte/cli in the worktree /work/cli-parse-flags (branch feat/parse-flags, base 9c1e2aa; hand-over folder /work/\_commit-plan/parse-flags-2026-11-10/). Step 1 of the plan adds a flag parser for `lot decide`, pinned by one table-driven test file, `src/lib/lot/parse-decide-flags.test.ts`, with about 60 rows. The row names are long and alike, for example "a decide with --round and --by and an unknown state is refused with the state list" and "a decide with --round and --by and a fixed state records the round". Do NOT run anything: write ./out/TEST-BRIEF.md, the test-station brief for step 1.
