<!-- dialecte-skills workspace -->

# Landing a change: commit-by-lots, human runs it

The agent prepares; a human reviews and commits. The agent never runs `git commit`, never pushes,
and never touches a repo's index (`git add`, `git checkout --`, `git stash`) while a hand-over
script may be waiting or running in the human's terminal.

## The hand-over

The agent writes only a lots file; `npx dialecte handover <lots.json>` does the rest. One lots file per lot
group, in an uncommitted hand-over folder (for example `_commit-plan/<topic>-<yyyy-mm-dd>/lots.json` at the
workspace root, outside every repo); the hand-over files are written next to it (`--out <dir>` elsewhere):

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
- **A branch lands on main through a merge lot**, in a lots file whose `repository` is the main checkout:
  `{ "kind": "merge", "branch": "<branch>", "tip": "<sha>", "resolved": {}, "message": "merge: ..." }` -
  a merge commit, never a fast-forward. `resolved` maps each conflicting path to the file holding its
  resolution (`null` removes it). The run needs the merge's `tree`, which the rehearsal prints (`tree <sha>`):
  copy it into the lot as `"tree"`, then `--rehash`.
- **Never in a lot**: generated docs data (`.vitepress/data/*`), lockfiles and version bumps (unless
  the lot is the release lot), local links to sibling repos. Restore them before the hand-over
  (`git checkout -- <file>` while no hand-over waits): a changed file in no lot makes `handover` refuse.
- **Interrupted?** A run stopped after staging a lot is refused at its next start with the command that
  unstages those files, with its `cd`: give it to the user.
- **Guards**, checked when the folder is written (nothing is written on a refusal) and again when it
  runs: the branch and HEAD, the hooks folder `core.hooksPath` names exists (a missing one makes git skip
  every hook), `lots.json` as reviewed, an empty index, every changed file in exactly one lot, no plan tag, standard citation or (from cli 0.3.0) name of a
  consuming tool in a lot's files (skill evals and test fixtures included) nor in its messages; when it runs, every file
  against the snapshot taken when it was written, and no other file changed; and, in a contributor package (cli 0.3.0), a green `dialecte contrib` record of the tree the lots
  leave (guard `contrib`; a rehearsal runs contrib in its clone when there is none).
- **The folder**: the lots file, the snapshot (`files.txt`, `files.sha256`, `files.deleted`) and a one-line
  `commit.sh` that runs `npx --no-install @dialecte/cli handover run <folder>` (it re-executes itself with
  bash: people run it with `sh`). Nothing per lot. The repository stays locked for `dialecte gate` until
  every lot is committed.
- **The run** prints each guard with its result and time, then `lot n/N`, the hook's output behind `│`
  with a heartbeat while it is silent, each commit with its stat, and the card at the end; it never
  pushes. A lot whose commit fails is unstaged again; the same command resumes after the lots already
  committed.
- **Rehearse** when the repository has a commit hook: `npx dialecte handover run <folder> --rehearse`
  commits the lots in a scratch clone holding the working tree, the hooks folder and a copy of
  `node_modules`, then removes it (`--keep` keeps it). From cli 0.2.0 it rehearses only what can find
  something new and prints why per lot. A plain lot is not rehearsed when its exact tree has a green
  `gate --full` (same lock, linked dependencies and command), the lot leaves the lock alone and the hook
  stages no files. A merge is not rehearsed when its tree is its branch tip's (main has not moved), the
  tip's tree has a green record (the branch commit's hook or a `gate --full`) and the merge leaves the lock
  alone; it still prints the merge's `tree <sha>`. Anything else is rehearsed: a merge onto a moved main, a
  lock change, a hook that stages files. Paste the per-lot lines with the card; `--full` forces every lot
  and is for when the person asks. A heavy hook that does run is rehearsed while another suite loads the
  machine, as it will be when the user commits; when that is not possible, the hand-over notes the machine's
  load at rehearsal time (`uptime`). The real commit's hook always runs.
- Edited a file after the snapshot (a review fix)? `npx dialecte handover --rehash <lots.json>`.
- `npx dialecte handover list` shows every hand-over folder with its state (pending, partly committed,
  committed, stale); after a merge, `npx dialecte worktree prune` lists the committed ones with the merged
  worktrees and prints their removal commands: an agent hands them (or the `--yes` command, which asks on
  a terminal) to the user with their `cd`.
- `handover` comes with `@dialecte/cli` 0.2.0 or later; with an older cli in the package, run
  `npx @dialecte/cli@^0.2.0 handover <lots.json>` (never `@latest`, which can be older).

## Commit messages

Conventional style (`feat(scope): ...`, `fix`, `docs`, `chore(bench)`, `chore(release)`), written
as the behaviour for a reader of the history. No plan/ticket tags, no standard citations.

## Hand-over message

From cli 0.3.1 the message points at the hand-over, it does not carry it: `READY`, then
`cd <worktree> && npx dialecte handover show <name>` (the card recomputed from the records, current whenever
it is read) and `npx dialecte handover run <name>` (what the person runs); then what was not verified. Never
a pasted or retyped card: it goes stale as soon as a record changes. With an older cli, the message is the
card `dialecte handover` printed - repository, worktree, branch, HEAD, gates, the lots with their files and
messages, and the command to run with its absolute `cd` - pasted as printed, never retyped.
