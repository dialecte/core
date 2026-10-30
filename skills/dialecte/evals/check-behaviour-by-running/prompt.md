---
tags: [dialecte]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

We build an app on a dialecte; our tests use @dialecte/core's own test dialecte (repository read-only at <dialecte-root>/core, built, where <dialecte-root> is the Dialecte checkout the eval runner points at; schema in src/test/generated/test.xsd: Root > A > AA_1 (exactly one per A) and AA_2 (at most two)). The dialecte cli is installed in our app (`npx @dialecte/cli --help`). A colleague claims that a transaction adding a second AA_1 under an A that already holds one is refused by core. Find out what really happens to the document, with evidence, and put what you ran and your answer in ./out/ (README.md plus the files you used).
