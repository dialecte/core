---
tags: [dialecte]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

Working on @dialecte/core (repository at <dialecte-root>/core, where <dialecte-root> is the Dialecte checkout the eval runner points at) - do NOT modify the repository; write the files you would change, with their intended repository paths, under ./out/. Task: add a Query method `getFirstChildOfTag(ref, tagName)` that returns the first direct child of a parent with the given tag name, with tests and docs, and a HANDOVER.md saying what you would run and how it lands.
