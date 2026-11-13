---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a Dialecte lot with sub-agents. Next lot, fully specified in the plan (`plans/rename-limit.md`, "Lot 3"): in @dialecte/core, rename the option `maxDepth` of `query.findDescendants` to `depth`, keeping `maxDepth` as a deprecated alias for one release. The project runs on a coding-agent host with no station agent files of any kind (the skills are in `.agents/skills/`). It can spawn a sub-agent with a prompt, a model and a sandbox mode (`read-only`: reads files and runs commands, writes nothing; `workspace-write`: also edits files in the workspace), and it can run a shell command in the background; it has no tool of another host. Do not run any agent: write, in ./out/SPAWN.md, which agent I spawn for the implementation and which for the review (the implementer has finished and reported), and what the spawn says about the model and the tools.
