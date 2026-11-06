---
tags: [dialecte]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our app (this folder, a Vite + TypeScript app) opens SCL projects on SQLite storage with the @dialecte/core release we upgrade to (see `package.json`; dependencies are not installed in this checkout). In `src/workspace.ts`, implement the two TODOs: `deleteWorkspace(name)` deletes the project without opening it, and `describeFailure(thrown)` returns the status-bar sentence for the cases its comment lists, telling them apart by the library's structured errors (never by matching message text). Change only `src/workspace.ts`. Then write `./out/answer.md` with: the call that deletes the project, which error key (and where it is declared) tells each case of `describeFailure` apart and how you know whether a write landed, and which package exports each function you import.

Input files: package.json, src/workspace.ts, src/engine.worker.ts
