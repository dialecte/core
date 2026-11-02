---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are implementing a lot in @dialecte/core on a laptop shared with three other agent sessions (`uptime` shows a load of 14). The lot is coded; you must now run the node tier (`npm run test:node`) and the browser-only tier of the package once, as its Definition of Done asks. Suppose the browser tier then reports 2 failed tests in `src/store/hub/hub-client.test.ts` and 1 in `src/io/export/export-file.test.ts`, 4318 passed. Do NOT run anything: write ./out/RUNS.md with the exact commands you run, in order (the first two runs, then what you run after the failures), and what you conclude and report in each outcome.
