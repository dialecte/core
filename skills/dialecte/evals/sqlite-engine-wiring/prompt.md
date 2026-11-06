---
tags: [dialecte]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our app (this folder, a Vite + TypeScript app) opens SCL and NSD projects on the default local store; see `src/workspace.ts`. We are moving both to SQLite storage with the @dialecte/core release we upgrade to next (dependencies are not installed in this checkout yet). Make the change: edit or add whatever files under `src/` it takes, nothing else. Then write `./out/answer.md` with: the files you wrote or changed, which package ships the SQLite engine worker, and what a page that imports `@dialecte/core/sqlite` but skips the rest of the setup gets when it opens an SCL project on `sqlite` storage.

Input files: package.json, src/main.ts, src/workspace.ts
