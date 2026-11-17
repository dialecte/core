<!-- dialecte-skills workspace -->

# Landing a lot in a CI-first repository

## Which flow lands the lot

Decide it once, before Station 0, from the repository itself:

- **CI-first**: main takes changes only through the merge queue. Its `.github/workflows/ci.yml` runs on
  `merge_group` and has a `ci-ok` job: CI checks every push of a pull request and runs the whole suite in the queue,
  on top of main. Today the cli and core. A lot there lands as this page says.
- **Hand-over**: every other repository (a dialecte, create, an app's own lot) until its CI moves. A lot there ends
  at the hand-over a person runs (Station 6 of the skill, and `dialecte-contributing` references/landing-changes.md
  in a dialecte package).

The repository decides, not the cli's `next:` line: `lot start` and `lot status` print a `next:` naming
`handover write` in both kinds. cli 0.8.1 and older still allow the hand-over verbs in a CI-first repository; newer
versions refuse `handover write` and `handover run` there and name `lot land`. Follow this page either way.

**Why it differs.** In a hand-over repository nobody but the person commits, so the agent prepares lots and a
script commits them under the hook. In a CI-first repository the merge queue is the person's last net: it tests the
tree on top of main before anything reaches it. The agent commits on its own lot branch, opens a draft pull
request, and the person's go queues it. A hand-over there is wasted work and a second, stale path to main.

## The flow

Run the repository's pinned cli, `npx dialecte <verb>` from the package root: the same version its commit hook and
CI call. Never `@latest` or another checkout's cli.

1. **Start**: `npx dialecte lot start <brief.json> --dry-run`, then without `--dry-run`. The worktree is made on
   the lot branch. An overlap with another open lot is refused: narrow the scope first - edit your brief's scope down to
   the files the lot touches before it starts, or ask the other lot's owner to run `lot scope <id> --drop <path> --add <file> --by <who> --reason <text>`; `--overlap-ok
   --by <who> --reason <text>` only with the orchestrator's go, never on your own. A lot that builds on another
   open lot's unmerged branch starts stacked: `lot start <brief.json> --on <lot>`.
2. **Test, then code**: the stations as the skill says - `npx dialecte tdd red` from the test station, then
   `npx dialecte tdd green` - or `lot exempt <reason>` for a lot that changes no behaviour.
3. **Local checks only**: `npm run check` and `npx dialecte rules` on the touched files, per step. No `gate --full`,
   no `contrib`, no whole suite, no rehearsal: CI runs them on the pushed tree. A repository with a `changes/`
   folder needs the lot's changelog fragment (`changes/<feature>.md`) or a `changes/<feature>.none.md` note with the
   reason, in the lot.
4. **Review**: the review rounds and the findings ledger as the skill says (`lot finding`, `lot decide`,
   `lot snapshot`).
5. **Commit on the lot branch**, in the lot's worktree, with the message the brief's `lots` give. The commit hook
   runs, never `--no-verify`. What it runs is the package's: one that declares `dialecte.gate.hook` (the cli today)
   checks the lot's tdd receipts, then its declared steps; one that does not (core today) runs its own hook script,
   `dialecte gate --hook` among it, which runs the full gate's steps - a commit there takes the suite's time, so run
   it in the background with a deadline. A hook that refuses is a finding: fix the cause, commit again.
6. **Land as a draft**: `npx dialecte lot land <id> --draft`. It rebases onto `origin/<base>` when main moved,
   pushes with a lease, opens (or updates) the draft pull request with its title and body rendered from the lot's
   records, and records it in `landing.json`. Never make a merge-of-main commit yourself: `lot land` rebases.
   - **A rebase conflict** is named and undone, nothing pushed. Rebase the lot branch yourself in its worktree:
     `git fetch origin`, `git rebase origin/<base>`, resolve the named files, `git add` them, `git rebase --continue`
     (the one place a CI-first lot writes the index besides its commit), then land again. A conflict whose right
     resolution is not obvious goes to the orchestrator, with the files and both sides, before you resolve it.
   - **A stale green after a rebase**: a hook that checks tdd receipts measures from the new merge-base with main.
     When it refuses, run the `tdd green` command its refusal prints (it names that base) with `npx`, then repeat
     what it refused: the commit, or `git rebase --continue` in the middle of a rebase (never `git commit` there). In
     a package whose hook runs the suite, run it in the background with a deadline, as in step 5.
7. **Report** the pull request to the orchestrator: its number, its head, the checks as CI reports them. Then stop.

The person reviews the draft and gives the go. Queueing is theirs: `lot approve <id> --by <the person>`, which marks
the draft ready and queues it, run by them or by the orchestrator on their go (the cli accepts `--by orchestrator`
for the cli's own lots only). The lot agent never runs `lot approve`, `gh pr ready` or
`gh pr merge`, and never `lot land` without `--draft`.

## Useful verbs on the way

- `npx dialecte lot forecast [<id>]`: the conflict forecast of the lot's work against main (as last fetched) and
  every other open lot, without a checkout. Run it before landing and when another lot lands in the same area.
- `npx dialecte lot pr <id> --print`: the pull request text the records render, before or after the landing.
- `npx dialecte lot review <id> --no-open`: the private half of the review (state, records, findings, what
  `lot approve` would refuse); `lot review <id> --pull --round <n>` brings the pull request's line comments back as
  findings of round `<n>`.
- `npx dialecte plan mark <plan.md> <id> superseded --by <who> --reason <text> [--replaced-by <id>]`: a plan entry
  another one replaced.
- `npx dialecte lot close <id>` once the pull request merged.

## Never, in a CI-first repository

- `handover write`, `handover run` or `--rehearse`, a `lots.json` or a hand-written commit script.
- A merge-of-main commit, a push outside `lot land`, a commit outside the lot's worktree and branch.
- `--no-verify`, `lot approve`, `gh pr ready`, `gh pr merge`, `lot land` without `--draft`.
