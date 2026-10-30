---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are implementing a lot in @dialecte/scl and must now run the mutation tests on the files you changed (`node scripts/mutants.ts fast src/v2019C1/extensions/identity`); they take about 25 minutes, and you want to keep working on the report meanwhile and only hand over once they finished. Do NOT run anything: write ./out/WAIT.md with the exact shell commands you would use to start the run and to wait for it, and how you decide whether it passed.
