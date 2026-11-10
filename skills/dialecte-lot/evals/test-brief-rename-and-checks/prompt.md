---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate the answer-by lot of @dialecte/cli in the worktree /work/cli-answer-by (branch feat/answer-by, base 41ad0e2; hand-over folder /work/\_commit-plan/answer-by-2026-11-10/). Step 2 of the plan renames the outputs of two commands across the 38 existing cases of `src/lib/review-rounds/*.test.ts`: lines that start `record review:` become `lot finding:` and lines that start `record decision:` become `lot decide:`. It also adds an option `--by <who>` to `lot answer`, recording who answered; the cases need values for it. The test station keeps a watcher on the test files while it works. Do NOT run anything: write ./out/TEST-BRIEF.md, the test-station brief for step 2, and ./out/ORCHESTRATOR.md, what you yourself do from spawning the test station until step 2 is green, in order.
