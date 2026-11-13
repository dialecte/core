---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You orchestrate a lot of a change of @dialecte/core on a coding-agent host with no station agent files of any kind (the skills are in `.agents/skills/`). It can spawn a sub-agent with a prompt, a model and a sandbox mode (`read-only`: reads files and runs commands, writes nothing; `workspace-write`: also edits files in the workspace), and it can run a shell command in the background; it has no tool of another host. You just launched, both in the background: the test station agent of step 2 (worktree /work/core-depth, branch feat/depth), and, in another worktree /work/core-names whose lot is finished, `npx dialecte handover run /work/core-names/.dialecte/handover/names --rehearse`, whose commit hook (the unit suite and the build) took 6 minutes on the last two rehearsals of this repository. You will be told when each one ends. Do NOT run anything: write ./out/NEXT.md with what you do from now until both have handed back, with the exact commands or tool calls, in order.
