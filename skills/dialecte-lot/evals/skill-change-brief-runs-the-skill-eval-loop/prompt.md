---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a lot of @dialecte/core (worktree /work/core-gate-wording, branch docs/gate-wording, base 47de9d2; hand-over folder /work/\_commit-plan/core-gate-wording-2026-11-02/). The lot changes only `skills/dialecte-contributing/SKILL.md`: the fast gate section should tell agents to read the count of tests in `dialecte gate --fast` output and treat 0 tests as a failure. Do not run anything. Write ./out/IMPLEMENTER-BRIEF.md: the brief for the implementer of this lot.
