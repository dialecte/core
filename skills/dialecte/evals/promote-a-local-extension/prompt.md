---
tags: [dialecte]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Our app (built on @dialecte/scl) has a local dialecte extension `bayHealth` under `src/dialecte-extension/bay-health/` with its tests; its verb `findEmptyBays` takes an option `countsAsEmpty` that our app sets from `bay-health.policy.ts`. Two other teams want the same verb. How does it get into @dialecte/scl, and what stays in our app? Do not run anything and post nothing: write the steps in ./out/PLAN.md and any text you would send in ./out/ as separate files.
