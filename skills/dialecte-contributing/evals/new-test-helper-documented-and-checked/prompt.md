---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

Add `assertSameRecordCount` to core's test entry (`@dialecte/core/test`), so dialecte packages can assert in their suites that two documents of a project hold the same number of records. Do NOT touch any repository: write ./out/PLAN.md with the full source of the new helper as you would write it (its file, its export, its doc comment) and the checks you would run before handing the change over, in order.
