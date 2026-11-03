---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a lot of @dialecte/cli (worktree /work/cli-mutants-expire, hand-over folder /work/\_commit-plan/mutants-expire-2026-11-10/). It adds `dialecte mutants expire --older-than <days>`: it reads the run entries under `<git-common-dir>/dialecte-mutation/runs/` and the survivor ledger `ledger.json` beside them, removes reported runs older than the limit that the ledger already took in, and re-reads StrykerJS's `mutation.json` report of the newest run to keep each survivor's `location` in the ledger. Several worktrees of one repository share that store, and a `dialecte mutants run` may finish while `expire` works. Do not run anything. Write ./out/PLAN-NOTES.md: what the plan and the test station's brief must hold before any code, and what the lot must show before its hand-over is READY.
