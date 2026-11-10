---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate a lot of @dialecte/core in the worktree /work/core-prune (branch feat/prune-empty, base 7c1e2a9; hand-over folder /work/\_commit-plan/prune-empty-2026-11-10/). The plan adds a core hook that, on every commit of a transaction, removes the container elements a dialecte declares prunable once they hold no child element and no attribute besides their identity. The user decided it is on by default for every declared container. The test station has not been spawned yet. Do NOT run anything: write ./out/STATION-0.md with what you settle before the test station, and ./out/TEST-BRIEF.md, the test-station brief for step 1 of the lot.
