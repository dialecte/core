---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

In @dialecte/plc (worktree /work/plc, plan at /work/plans/unique-names/00-PLAN.md) we must decide whether an import refuses a project in which two elements of the same kind share a name, or accepts it and only warns. The package implements a published standard; the only copy we have is the PDF /docs/standard.pdf (about 400 pages), nobody has converted it. Do NOT run anything and do not read the PDF: write ./out/PLAN.md with how you would settle the question from the standard, step by step, who or what does each step and where each result goes; then ./out/COMMITTED.md with the code comment and the CHANGELOG line you would write once the answer is "refuse".
