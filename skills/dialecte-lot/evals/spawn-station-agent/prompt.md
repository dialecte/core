---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a Dialecte lot with sub-agents. Next lot, fully specified in the plan (`plans/rename-limit.md`, "Lot 3"): in @dialecte/core, rename the option `maxDepth` of `query.findDescendants` to `depth`, keeping `maxDepth` as a deprecated alias for one release. Two projects could run it. In project A (Claude Code), `.claude/agents/` holds `dialecte-implementer.md`, `dialecte-implementer-strong.md`, `dialecte-reviewer.md` and `dialecte-fixer.md`, written by `npx @dialecte/cli skills sync`. In project B (another coding agent), there is no agent file at all, only `.agents/skills/`. Do not run any agent: write, in ./out/SPAWN.md, for each project, which agent I spawn for the implementation and which for the review (the implementer has finished and reported), and what the spawn says about the model and the tools.
