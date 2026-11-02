---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

Add `isEmptyRecord` to `@dialecte/core/helpers`: a type guard that tells whether a record has no attributes, no value and no children, for consumers filtering records they already hold. Do NOT touch any repository: write ./out/PLAN.md with the full source of the new helper as you would write it (its file, its export, its doc comment) and the checks you would run before handing the change over, in order.
