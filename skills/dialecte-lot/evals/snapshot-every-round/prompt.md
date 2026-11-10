---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate a lot of @dialecte/plc in the worktree /work/plc-names (branch fix/names, base 9d0b1f3; hand-over folder /work/\_commit-plan/names-2026-11-10/; risk class test API or internal code, 2 rounds). The installed `@dialecte/cli` is 0.4.0. Round 1 found three should-fix findings; the fixer reported all three fixed with their blast radius, and you recorded them `fix-to-verify`. The fixer took its reds on the throwaway worktree /work/plc-names-round-1, which is still there. You now run round 2, the last: a verify-only delta review of the three fixes. Do NOT run anything: write ./out/NEXT.md with the exact commands and spawns in order, from now until the round-2 verdict is recorded in the ledger and the throwaway is handed to the user for removal.
