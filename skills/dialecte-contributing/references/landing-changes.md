<!-- dialecte-skills workspace -->

# Landing a change: commit-by-lots, human runs it

The agent prepares; a human reviews and commits. The agent never runs `git commit`, never pushes,
and never touches a repo's index (`git add`, `git checkout --`, `git stash`) while a hand-over
script may be waiting or running in the human's terminal.

## The script

`npx dialecte handover <lots.json>` writes it. One lots file per lot group, in an uncommitted hand-over
folder (for example `_commit-plan/<topic>-<yyyy-mm-dd>/lots.json` at the workspace root, outside every
repo); the script and its files are written next to it (`--out <dir>` elsewhere):

```json
{
	"repository": "/absolute/path/to/the/repository",
	"branch": "feat/the-branch",
	"head": "<sha the lots go on top of>",
	"gates": "the gate lines, one line, with their real counts",
	"lots": [
		{ "paths": ["src/feature/"], "message": "feat(scope): the behaviour\n\nThe body." },
		{ "paths": ["CHANGELOG.md"], "message": "docs(changelog): the behaviour" }
	]
}
```

- **Lots**: paths are files, or folders ending with `/`. Every lot is build-safe on its own (compiles,
  tests green) and does not reference a later lot. Typical order: types/constants → implementation +
  tests → docs → CHANGELOG → bench re-baseline (own lot) → release bump (own lot).
- **Never in a lot**: generated docs data (`.vitepress/data/*`), lockfiles and version bumps (unless
  the lot is the release lot), local links to sibling repos. Restore them before the hand-over
  (`git checkout -- <file>` while no script waits): a changed file in no lot makes `handover` refuse.
- **Guards**, checked when the script is written (nothing is written on a refusal) and again when it
  runs: the branch and HEAD, an empty index, every changed file in exactly one lot, no plan tag or
  standard citation in a lot's files (skill evals and test fixtures included) nor in its messages.
  When it runs, the script also checks every file against the snapshot hashes taken when it was
  written and that no other file changed. The hand-over prints each lot with its file count, lines
  added and removed and its snapshot hash: an empty or unexpected lot shows before anyone runs it.
- Edited a file after the snapshot (a review fix)? `npx dialecte handover --rehash <lots.json>`.
- The script re-executes itself with bash (people run it with `sh`), prints
  `git --no-pager show --stat` after each commit, and never pushes. The repository stays locked for
  `dialecte gate` from the moment the script is written until it has committed.
- `handover` comes with `@dialecte/cli` 0.2.0 or later; with an older cli in the package, run
  `npx @dialecte/cli@latest handover <lots.json>`.

## Commit messages

Conventional style (`feat(scope): ...`, `fix`, `docs`, `chore(bench)`, `chore(release)`), written
as the behaviour for a reader of the history. No plan/ticket tags, no standard citations.

## Hand-over message

Give the absolute path of the script and the one command to run it, in its own code block,
starting with the `cd` (the last line `dialecte handover` prints). Say what each lot contains, which gates ran with their real counts, and
what was not verified.
