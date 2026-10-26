---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

I orchestrate sub-agents on the Dialecte repositories (checked out side by side in <dialecte-root>, the Dialecte checkout the eval runner points at; read-only for you). Two concerns for the next lot: (1) in @dialecte/core, a helper that returns the depth of a record below the root, with tests; (2) in @dialecte/cli, a `dialecte depth <file> <tag>` command using it. Nothing of this is committed yet; the core repository's main branch is clean. Do not run any agent: write, in ./out/, the briefs I should give to each implementer and to the reviewer, plus ORDER.md saying in which order they run and what I do between the steps.
