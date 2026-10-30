---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a lot of @dialecte/core (worktree /work/core-depth-default, branch feat/depth-default, base 80fe770, plan /work/implementation-plans/QUERY/04-depth-default.md, hand-over folder /work/\_commit-plan/depth-default-2026-10-30/). The lot changes the default of the `depth` option of the exported helper `findDescendants` from unlimited to 1; it touches files under src/ and CHANGELOG.md. The implementer's report: "All 9 cases red then green, fast gate green, nothing left to check." Do not run anything. Write ./out/REVIEW-BRIEF.md: the brief for the round-1 reviewer (Station 3).
