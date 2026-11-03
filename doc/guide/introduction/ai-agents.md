---
description: Working on or with Dialecte through a coding agent (Claude Code, GitHub Copilot, Cursor, Codex, Gemini CLI). Every Dialecte package ships agent skills versioned with its code; dialecte skills sync installs them, llms.txt serves agents without skills.
---

# Working with AI agents

Coding agents write better Dialecte code when they know how it is split: the engine in core, the
generated definition, the hooks that keep a document coherent, the business verbs of each dialecte.
Without that, they rewrite what already exists - an attribute reader, an ancestor walk, a reference
fix-up a hook already performs.

## Skills ship with the packages

Every Dialecte package carries the [agent skills](https://agentskills.io) that describe it, in
`skills/<name>/SKILL.md`, published with the package and versioned with its code:

| Package              | Skills                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dialecte/core`     | `dialecte` (architecture, reuse ladder, hooks, testing), `dialecte-contributing` (changing Dialecte: placement, gates, code rules), `dialecte-lot` (delivering a change as stations: red-first implement, independent review, hand-over, retro) |
| `@dialecte/scl`      | `dialecte-scl` (SCL business verbs, what the hooks keep coherent, reference registries)                                                                                                                                                         |
| `@dialecte/create`   | `dialecte-create` (generating a dialecte from an XSD)                                                                                                                                                                                           |
| a generated dialecte | `dialecte-<id>` (its own verbs and hooks)                                                                                                                                                                                                       |

Install them for your agents from your project root:

```bash
npx @dialecte/cli skills sync
```

This links the skills of your dependencies into `.claude/skills` (Claude Code) and `.agents/skills`
(Codex, Cursor, Gemini CLI, GitHub Copilot). Add `--agent copilot` for `.github/skills`, `--copy` to
copy instead of link. Links follow the versions you have installed; run it again after adding a
Dialecte dependency. It installs the skills for using Dialecte; the skills for changing a Dialecte
package (`dialecte-contributing`, `dialecte-lot`) come with `--contributing`, which later syncs
remember until `--no-contributing`. Working on Dialecte itself, `--from <folder> --contributing` takes every skill from your
local checkouts (needs `@dialecte/cli` 0.2.1 or later).

The skills tell the agent to confirm every signature in the version you run (the repository or
`node_modules/@dialecte/*/dist`), so keeping the Dialecte repositories checked out next to your
project makes it more precise still.

How a change to Dialecte itself goes from a plan to a published version with agents - the steps,
the gates, the review rounds and the hand-over you run - is explained for people in
[Delivering a change with agents](../development/delivering-with-agents.md).

## Documentation for agents without skills

Each documentation site publishes an `llms.txt` index (and `llms-full.txt`, the full text):
`https://dialecte.github.io/core/llms.txt`, `https://dialecte.github.io/scl/llms.txt`. Point your
agent at the index, then at the page it needs.

## Skills stay true to the code

A skill changes in the same pull request as the code it describes. In each package:

- `npm run skills:generate` rewrites the parts that drift fastest (the verb map of the extensions,
  the method index, the hook files) from the source;
- `npm run skills:check` fails when a skill cites an API, a path or a script
  that no longer exists.

Both scripts call `@dialecte/cli` 0.2.0 or later; with an older cli in the package, run
`npx @dialecte/cli@latest skills generate` / `npx @dialecte/cli@latest skills check`.

Every skill ends with a retro step: the agent reports where the skill was wrong or missing and
drafts the fix as a before/after edit. You approve it before it lands, in the same change, with an
eval case that fails on the old text.
