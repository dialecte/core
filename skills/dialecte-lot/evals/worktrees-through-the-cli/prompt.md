---
tags: [dialecte]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

The workspace /work holds the repositories `core` and `cli` side by side. You orchestrate a change that needs one implementer in core (branch feat/depth, from main) and one in cli (branch feat/depth-flag, from main); core has a husky pre-commit hook and both have their node_modules installed in the main checkout. Later, the user tells you both branches are merged into main and the hand-overs committed. Do NOT run anything: write ./out/SETUP.md with the exact commands that give each implementer its worktree, and ./out/CLEANUP.md with the exact commands you run after the merge.
