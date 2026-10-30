---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I test a rename verb of our app's custom extension with a dialecte package's table runner (`run<Name>TestCases`), on a real 20 MB file read from `fixtures/big-station.xml`. After the rename, every `Bay` must still sit under its `VoltageLevel` and exactly 412 `LNode` must remain. My plan: `expectedQueries: ['//default:LNode']` plus a count, or export with `project.export({ documentId, xmlDocument: true })` and count with `document.evaluate`. Is that right? Write ./out/TEST.md: how I assert this, with the test code. Do not run anything.
