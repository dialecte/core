---
tags: [dialecte]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You work in a web app built on @dialecte/scl (repository /work/grid-app, its `package.json` has no `dialecte` field; `@dialecte/cli` 0.3.0 and the app's synced skills are installed). The task: a local extension under `src/dialecte/extensions/bay-labels/` that adds a query listing the bays without a label, and the app's service `src/services/bay-labels.service.ts` that calls it. You orchestrate it as one lot with sub-agents. Do NOT run anything: write ./out/PLAN.md with every station of the lot in order, from the brief to the end of your part, the `dialecte` command each one runs, and what happens after your part ends.
