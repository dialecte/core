### Changed

- The `dialecte-lot` and `dialecte-contributing` skills land a lot in a CI-first repository with plain `npx dialecte lot land <id>`, which always opens a draft pull request (the cli no longer takes `--draft`): `lot land` never queues; only `lot approve`, by a person, does.
- The `dialecte` skill's table of cli lookups points at `references/ask-ladder.md`: an agent's own question goes through `npx @dialecte/cli ask "<question>"` before a person.
