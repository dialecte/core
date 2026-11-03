---
tags: [dialecte]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I work in our web app (not a dialecte repository; it consumes @dialecte/scl and has its own agent skills, a pull request skill and template among them). I ran one lot of an app change with your stations: tests red first with `dialecte tdd`, `dialecte gate`, an independent review, and `dialecte handover` wrote the hand-over folder; I ran its commit.sh and the lots are committed on my branch. What happens next, and with which skill? Do not run anything: write the next steps in ./out/NEXT.md.
