---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a Dialecte lot with sub-agents, in Claude Code (`.claude/agents/` holds every `dialecte-*.md` agent `npx @dialecte/cli skills sync` writes). The lot, fully specified in `plans/clamp-depth.md` (read-only, not in this folder; take this message as its content): in @dialecte/core, `query.findDescendants` gains an option `depth` (a positive integer; 0 or a negative value throws `INVALID_DEPTH`; a depth above the tree's height returns every descendant). Step 1 of the brief holds those three behaviours; step 2 adds the doc page and the CHANGELOG line. The worktree is /work/core-depth on branch feat/clamp-depth, base 4be1c07. Do not run any agent: write ./out/ORDER.md - for step 1, every agent I spawn, in order, what each one may change, which command closes its work, and what happens when the implementer finds a test wrong.
