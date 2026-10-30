---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate two Dialecte lots in @dialecte/core (worktree /work/core-wording, branch feat/wording, base 4be1c07). The wording lot only rewords the message of the error `INVALID_DEPTH` (no behaviour changes, no test asserts on the wording) and renames a local variable. The behaviour lot makes `query.getChild` throw `CHILD_NOT_FOUND` instead of returning undefined. `dialecte gate --fast` runs a `tdd` step that fails on new or changed test cases without red and green receipts. Do not run anything: write ./out/PLAN.md - per lot, how the gate's tdd step will pass, and any file I write for it (its path, its exact content, and whether it is committed).
