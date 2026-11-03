---
tags: [dialecte]
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Our Vue app is built on @dialecte/core with @dialecte/scl installed. `bay-panel.vue` (attached) cannot be unit-tested without mounting it and its document code cannot move to a package later. Restructure it. Do not run anything: write every file of the result under ./out/ and, in ./out/NOTES.md, one line per file saying what it owns.
