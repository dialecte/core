---
tags: [dialecte]
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Our Vue app is built on @dialecte/core with @dialecte/scl installed. A panel must list the Bays of a VoltageLevel that hold no ConductingEquipment. Our product counts a Bay holding only a ConductingEquipment of type `IFL` (an infeed line) as empty too; another product reusing this code would not. Nothing in @dialecte/scl does this yet (assume `npx @dialecte/cli api find` found nothing). Do not run anything: write the files you would add under ./out/ (paths relative to the app's `src/`), including the test, and in ./out/NOTES.md say in a few lines where each file sits and why.
