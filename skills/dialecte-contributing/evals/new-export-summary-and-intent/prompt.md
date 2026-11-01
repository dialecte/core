---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

In @dialecte/core, add a function `missingRequiredChildren` to the `@dialecte/core/utils` entry: given a definition and the tag names of the children an element holds, it returns the required child tag names that are missing. Do NOT touch any repository: write ./out/PLAN.md with the full source of the new function as you would write it (its file, its export, its doc comment) and every command you would run before handing the change over, in order.
