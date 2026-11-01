---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are the fixer (Station 4) of round 1 of a lot of @dialecte/cli, in the worktree /work/cli-ranges (branch feat/ranges, base 7c1e0a2). The hand-over folder is /work/\_commit-plan/cli-ranges-2026-11-01/; it holds `findings-ledger.md` and the snapshot round 1 reviewed, `round-1/` with `round-1.deleted`. Round 1 raised:

- R1-2 should fix `src/lib/range.ts:14` - `parseRange('9-3')` returns `{ from: 9, to: 3 }` instead of refusing a reversed range

You agreed and already changed `src/lib/range.ts`: it now throws `reversed range 9-3`. Then you added the case `a reversed range → refused` to `src/lib/range.test.ts`; it passes. You still owe the red of that new case. Do not run anything: write, in ./out/PLAN.md, the exact commands you would run, in order, to get that red, and the lines of your fix report for R1-2.
