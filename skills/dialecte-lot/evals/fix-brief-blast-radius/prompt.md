---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a lot of @dialecte/scl (worktree /work/scl-node-tier, branch feat/scl-node-tier, base be131c1; hand-over folder /work/\_commit-plan/scl-node-tier-2026-10-30/). The lot moves scl's unit tests to the Node tier and adds `src/test/node-tier.test.ts`, which scans `src/**/*.test.ts` and fails when a Node-tier test imports a browser-only module. Round 1 of the review (Station 3) came back with these findings, now open in the findings ledger:

- R1-1 `src/test/node-tier.test.ts:31` - the scan skips `*.browser.test.ts` by suffix only, so a browser test named `import.test.ts` under `src/store/` is scanned and fails the guard (should fix)
- R1-2 `src/test/node-tier.constants.ts:8` - `BROWSER_ONLY_MODULES` lists `@vitest/browser` but not `@vitest/browser/context`, so a Node-tier test importing it passes (blocking)
- R1-3 `vitest.config.ts:22` - the Node project's `include` and the browser project's `include` overlap on `src/store/**` (should fix)

Do not run anything. Write ./out/FIX-BRIEF.md: the brief you hand the fixer (Station 4) for round 1.
