<!-- dialecte-skills workspace -->

# A lot in a dialecte package

The `dialecte-lot` stations run the same in every repository. In a dialecte package - `"dialecte": { "profile":
"contributor" }` in its `package.json`: core, a dialecte, create, cli - they gain the steps below. An app runs none
of them: its lot ends at the hand-over.

## Station 0 - the mutation switch

- **Mutation switch** (a package that declares a mutation scope): the orchestrator sets it per lot in the worktree's
  `.dialecte/lot.json` with `dialecte lot mutation <mode>` and names it in the brief - the default (`changed` when the
  diff touches the scope, `off` otherwise) for most lots, `gate` only for a robustness lot (its hand-over waits for
  a run reported on the tree it commits: it runs again after the last fix), `audit` on request. The implementer
  starts `dialecte mutants run` in the background once green and judges the survivors as [SKILL.md](../SKILL.md)
  (Mutation testing) says. Before a release, a full audit in the background;
  its survivors become named follow-up lots (`dialecte mutants schedule <follow-up lot> <key>`).

## Station 2 - `dialecte rules`

With the fast gate, run `npx dialecte rules` from the package root and fix every error before the review; answer
every warning ([code-rules.md](code-rules.md)). The implement report's `Gates:` line adds
`rules <n errors, m warnings>`.

## Station 5 - `dialecte contrib` after the full gate

From `@dialecte/cli` 0.3.0, once `gate --full` is green, run `npx dialecte contrib`: `rules` on the files changed
against HEAD, the package's contrib steps (by default the docs build, its generated docs restored, and the type
bench), `release` (no dependency named by a local folder) and `mutation` when a scope is declared. A step the full
gate passed on the same tree and install is not run again (`reused from gate --full`). Paste its lines with the
gate's. The hand-over's `contrib` guard refuses a tree without a green record of it; a rehearsal runs it in its
scratch clone when there is none.

## Station 6 - mutation, landing, merges

- The landing rules apply: [landing-changes.md](landing-changes.md) (lots, guards, rehearsal, merge lots).
- In a package with a mutation scope, run `dialecte mutants status`
  before every hand-over and every merge: a `new` survivor or a `died` run blocks the card and the guard until it is
  handled ([SKILL.md](../SKILL.md), Mutation testing); the lot's own run still running blocks only a merge or a `gate`
  lot (on a plain hand-over it is a `!`).
- A merge onto a main that moved since the cut leaves a tree no check has seen: it is rehearsed. The branch's green
  records say nothing about it - not its suite, nor a gate step the hook does not run (docs, skills check, the
  browser suite). The rehearsal's hook runs the suite on the merged tree; run only the steps the hook does not run,
  in the clone `--rehearse --keep` leaves, never a `gate --full` that would run the suite there again. A `reused`
  line for such a merge is a cli bug to report, never a result to pass on.
