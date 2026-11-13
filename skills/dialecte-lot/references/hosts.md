<!-- dialecte-skills workspace -->

# Hosts

The one page that names hosts and their tools (it never names a model: a tier becomes a model through
`npx @dialecte/cli models`). Every other skill page says the procedure; this page says how a host does it.
The stations, gates and hand-over are the same on every host: they run through the `dialecte` cli and the git
hooks.

## Every host

- **Session start**: `npx --no-install @dialecte/cli doctor --brief` (the project's `AGENTS.md` says so; where a
  hook already ran it, its lines are in your context, and running it again is harmless): nothing printed means
  the skills are in sync, else fix each line first.
- **Skills**: `npx @dialecte/cli skills sync` installs them in the folders of the hosts the project uses.
- **Stations**: a general sub-agent per station, as [stations.md](stations.md) defines it, unless the host has
  a station adapter below.
- **Deadlines**: the host's own scheduler or a timer arms the deadline at launch; else poll at the deadline.
- **Skill evals**: the [skill-eval loop](skill-eval.md) by hand with the `eval-runner` and `grader` stations,
  unless the host has a skill-evaluation tool below.

## Claude Code

- Skills in `.claude/skills/` (`skills sync --agent claude`, a default).
- A `SessionStart` hook runs the session check.
- Station adapters: `.claude/agents/dialecte-<station>.md`, written by `npx @dialecte/cli skills sync` whenever
  it installs `dialecte-lot`; the Agent tool spawns them by name.
- Skills load with the Skill tool; the skill-evaluation tool is the skill-creator skill
  (`anthropic-skills:skill-creator`).
- The Workflow tool is the multi-agent workflow that needs the person's opt-in.
- A scheduled wake-up or a monitor arms a deadline.

## Codex, Cursor, Gemini CLI, Copilot

- Skills in `.agents/skills/` (`skills sync --agent agents`, a default; read by Codex, Cursor, Gemini CLI and
  Copilot), or `.github/skills/` (`--agent copilot`).
- No station adapter: a general sub-agent per station, with the narrowest sandbox that allows the station's
  access.
- Its own scheduler or a timer arms a deadline, else poll at it.
