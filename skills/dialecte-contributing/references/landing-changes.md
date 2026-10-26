<!-- dialecte-skills workspace -->

# Landing a change: commit-by-lots, human runs it

The agent prepares; a human reviews and commits. The agent never runs `git commit`, never pushes,
and never touches a repo's index (`git add`, `git checkout --`, `git stash`) while a hand-over
script may be waiting or running in the human's terminal.

## The script

One script per lot group, in an uncommitted hand-over folder (for example
`_commit-plan/<topic>-<yyyy-mm-dd>/commit.sh` at the workspace root, outside every repo).

- Starts with a bash re-exec guard and `set -euo pipefail` (people run it with `sh`; macOS bash is
  3.2, so no `mapfile`).
- `cd` to the absolute path of the repo.
- **Lots**: each lot is a set of explicit `git add <paths>` plus one `git commit`. Every lot is
  build-safe on its own (compiles, tests green) and does not reference a later lot. Typical order:
  types/constants → implementation + tests → docs → CHANGELOG → bench re-baseline (own lot) →
  release bump (own lot).
- **Never added**: generated docs data (`.vitepress/data/*`), lockfiles and version bumps (unless
  the lot is the release lot), local links to sibling repos.
- **Guards**: hash each lot's diff when the script is written and refuse to run if the files
  changed since (print `--stat` next to each hash so an empty diff is visible); refuse if a lot's
  files or commit messages contain plan/ticket tags or standard citations (the greps in
  code-rules.md).
- Prints `git --no-pager show --stat` after each commit. No push.

## Commit messages

Conventional style (`feat(scope): ...`, `fix`, `docs`, `chore(bench)`, `chore(release)`), written
as the behaviour for a reader of the history. No plan/ticket tags, no standard citations.

## Hand-over message

Give the absolute path of the script and the one command to run it, in its own code block,
starting with the `cd`. Say what each lot contains, which gates ran with their real counts, and
what was not verified.
