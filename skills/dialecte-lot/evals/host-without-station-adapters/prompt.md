---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a Dialecte lot in Codex CLI, on a project where `npx @dialecte/cli skills sync --contributing` ran: the skills are in `.agents/skills/`, there is no `.claude/` folder and no agent definition file of any kind. Codex can spawn a sub-agent with a prompt, a model and a sandbox mode (`read-only`: reads files and runs commands, writes nothing; `workspace-write`: also edits files in the workspace); it has none of Claude Code's tools. The lot changes skill text of `dialecte-lot` (plan `plans/skill-wording.md`, "Lot 2"), and I am just starting the session. Do not run anything: write ./out/SPAWN.md saying what I run before the first station, and, for the test reviewer, an eval runner and a grader: the tier (and how I turn it into a model), the sandbox mode, and what each spawn prompt carries besides the brief; and what I do so that I am not left waiting forever if the test reviewer, launched in the background, never reports back.
