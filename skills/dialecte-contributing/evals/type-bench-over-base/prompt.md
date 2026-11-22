---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I work on a lot of @dialecte/core (CI-first, pinned @dialecte/cli 0.10.0) that adds a new generic overload to `query.getChildren`. Its changelog fragment is `changes/children-overload.md`. On the pull request, CI's type-perf job fails: `npm run type-bench:check` prints `coverage: calls  +7.8% over its base` and exits 1. The overload is the intended design and the extra cost is accepted. Do not run anything: write ./out/PLAN.md with what I change, the exact command lines, the files I touch, and what I must not do.
