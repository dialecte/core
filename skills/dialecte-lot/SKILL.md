---
name: dialecte-lot
description: Deliver one lot of a Dialecte change (core, a dialecte package, create, cli) as a small pipeline of stations - orchestrate, implement red-first, gate, review independently, fix, hand over, retro - alone or with sub-agents. It gives the orchestrator's brief template, the implementer's and reviewer's report shapes, the review passes, the loop cap, when a skill change goes through skill-creator evals, and how findings become skill improvements. Use it whenever a Dialecte change is bigger than a one-file fix, when you split work between agents (implementer, reviewer), when the user asks for TDD with a review loop, a commit-by-lots hand-over, or a retro, even if they do not name the stations. Load dialecte-contributing (gates, code rules) and dialecte (the API) with it.
license: MIT
metadata:
  author: dialecte
  version: '0.1.0'
---

<!-- dialecte-skills workspace -->

# Delivering a Dialecte lot

A lot is the smallest change that is worth landing on its own: build-safe, tested, documented, reviewed.
This skill runs it as **stations**. Each station has one job, reads only what the brief hands it, and
leaves an artifact behind. One agent can play every station in turn; an orchestrator can hand them to
sub-agents. Either way the stations, the order and the report shapes are the same, so a retro can
compare runs.

**Memory is the artifacts, not the chat.** The plan file, the station reports, the diff and the retro log
are what the next station reads. A decision that is not in one of them was not a decision.

## The stations

| #   | Station     | Who                         | Tier                                                        | Reads                                                                                                | Leaves                                                                                                       |
| --- | ----------- | --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0   | Orchestrate | orchestrator                | strong                                                      | the plan, the user's decisions                                                                       | one brief per implementer (template in [references/briefs.md](references/briefs.md))                         |
| 1a  | Test        | test station (own agent)    | standard                                                    | its brief step, the existing code                                                                    | tests + stubs, proven red by `dialecte tdd red` (its receipts)                                               |
| 1b  | Test review | **a different agent**       | strong                                                      | the tests of the step, the brief                                                                     | a verdict on the tests, before any code                                                                      |
| 1c  | Implement   | implementer (another agent) | standard or strong, by lot kind                             | its brief, the tests, the code it changes                                                            | production code until `dialecte tdd green`; an implement report                                              |
| 2   | Fast gate   | implementer                 | no agent                                                    | -                                                                                                    | `dialecte gate --fast` + `dialecte rules`: type-check, lint, format, touched tests, skills check, code rules |
| 3   | Review      | **a different agent**       | strong, both passes                                         | the brief, the diff, the previous version (`git show <base>:<file>`), the rules, the findings ledger | a review report: pass 1 correctness, pass 2 fit, verdict; proposed findings-ledger rows                      |
| 4   | Fix         | the implementer, fix mode   | standard for wording or naming, else the implementer's tier | the findings                                                                                         | each finding fixed, disagreed (one line why) or escalated                                                    |
| 5   | Full gate   | implementer                 | no agent                                                    | -                                                                                                    | `dialecte gate --full`: the package's full Definition of Done, once per lot                                  |
| 6   | Hand over   | implementer or orchestrator | no agent                                                    | the lot's files                                                                                      | `dialecte handover`: a hand-over folder and its card; a human runs it; nothing committed, nothing pushed     |
| 7   | Retro       | orchestrator                | strong                                                      | reports, loops, the user's corrections                                                               | retro entries; skill edits drafted, applied on approval                                                      |

The Tier column names the kind of model a station runs on, never a model: the tiers, the rules that go with
them (escalate one tier after a failed round, never down-tier a correctness review, effort as a second knob)
and how to learn which model a tier is (`npx @dialecte/cli models`) are in
[references/model-tiers.md](references/model-tiers.md).

Stations 3-4 loop on the same lot. **The cap is set by the lot's risk class**, declared in the findings ledger
before round 1 (round 1 full, the later rounds delta: Station 3). A round beyond the cap is the user's call, never
the orchestrator's: a finding the last round acts on is fixed, then the fix and the open rows go to the user, who
decides whether one more round checks it. Findings that keep coming past the cap mean the plan or the brief is
wrong.

## Station 0 - what the plan and the brief settle

Before the test station, the plan holds what the tests will pin; a gap found by a reviewer costs a round.

- **Mutation switch** (a package that declares a mutation scope): the orchestrator sets it per lot in the worktree's
  `.dialecte/lot.json` with `dialecte lot mutation <mode>` and names it in the brief - the default (`changed` when the
  diff touches the scope, `off` otherwise) for most lots, `gate` only for a robustness lot (its hand-over waits for
  a run reported on the tree it commits: it runs again after the last fix), `audit` on request. The implementer
  starts `dialecte mutants run` in the background once green and judges the survivors as `dialecte-contributing`
  (Mutation testing) says. Before a release, a full audit in the background;
  its survivors become named follow-up lots (`dialecte mutants schedule <follow-up lot> <key>`).
- **A tooling lot with shared state or an external tool**: the plan carries the store's transition table, its
  invariant and the interleavings, the test-station brief asks one forced-order test per interleaving, and the
  hand-over folder gets a `SMOKE.md` with the lot's one real run; how and where that run happens, and citing
  third-party values: `dialecte-contributing` references/traps.md, Tools with shared state.

## Station 1 - test, test review, implement (per brief step)

The order matters, not only the outcome: a test written after the code can be shaped to please it. So each
step of the brief (3-6 behaviours) goes through three agents, and the cli keeps the receipts:

1. **Test station** (own agent, `standard`; `dialecte-test-writer` in Claude Code). Reads the brief step and
   the existing code only. Writes the step's tests from the spec and, where the code does not exist yet,
   stubs with their real types whose body throws `new Error('not implemented: <name>')`; each test calls
   the code under test inside an `expect(...)` that a matcher completes (`expect(x).toBe(...)`; a bare
   `expect(x)` asserts nothing). It removes every focus marker (`.only`, a table case's `only: true`)
   before the red: `tdd red` refuses a file that holds one. Then `npx dialecte tdd red`: it runs every
   case of the changed test files; each new or changed case must fail on an assertion, on the stub's error
   inside `expect(...)`, or on an error existing code throws there (a bug the test pins). A snapshot test
   gets its snapshot written by the test station before the red (runs never write one). A case that
   passes ("it ran green: this test proves nothing yet"), or fails on a missing export, a type or syntax
   error, a timeout, or a stub thrown at import or before the assertion, is refused with its kind; a
   refusal records no red of its file: fix the test, never the code. A red freezes each test file without
   a refusal; a changed helper, fixture or snapshot is frozen only by a red of a file that depends on it
   (imports it - relative, tsconfig `paths` or vite alias, through barrels - names it, or owns the snapshot;
   an import that looks local and resolves nowhere refuses the file). Its report is the `tdd red` output.
2. **Test review** (a different agent, `strong`, read-only; `dialecte-test-reviewer`). Reads only the tests
   against the spec, before any code - the changed helpers, fixtures and snapshots too: does each pin a
   behaviour of the brief, would a plausible wrong implementation fail it, does every `expect(...)` have a
   matcher, is a behaviour of the step left without a test. Verdict: approve, or back to the test station
   with the findings (which runs `tdd red` again).
3. **Implement station** (another agent: `dialecte-implementer`, or `-strong` by lot kind). Changes
   production code only, until `npx dialecte tdd green` passes: every case of the step with its red
   receipt, its test code as the last red run froze it, production changed since its red, and green. A
   test it finds wrong goes **back to the test station with the reason** (through the orchestrator): it
   never weakens, skips or deletes a test, and never runs `tdd red` itself. When it did edit a test (or a
   helper, a fixture, a snapshot) and `tdd green` refuses it, it **undoes its own edit by hand first** -
   puts back the text the test station wrote, no git command - then hands the case back with the reason.

What the cli guarantees, and what it only makes visible: `tdd green` and the gate refuse test code
changed since the red run that froze it, a case whose own test call changed since its receipt, a green
with nothing changed in production, and new or changed test code never proven red. A re-red does not
launder an edit: a passing case still waiting for its green whose test file or imported test code changed
is refused ("test code changed since its red and it passes"); a green case kept at such a run is flagged
`test code changed around it` (the honest next step, a case added to a green file, shows it too). The
receipts live in the worktree's git folder: an agent with a shell can still write them by hand, so they are
evidence, not a lock. What looks like cheating is shown, not hidden: every refusal is kept in the ledger,
a red at a production state the case had already left is flagged `rollback`, a green case made red again
at the same production `red after green`; `tdd status`, the gate and the hand-over card print the flags.
What it cannot see: a deliberate throw in production looks like a stub; code written first, hidden, then a
red taken at the base state cannot be told from an honest red (at the first step the red's production is
the base's). The review reads the diff for those.

Then the next step. `npx dialecte tdd status` shows each case: red, green, unchanged, missing receipt,
test edited after red; the test code changed since its freeze; the cases the change deletes. `gate
--fast` and `--full` check the receipts in their `tdd` step: every test-code file of the change as frozen,
every new or changed case red then green (or unchanged), the flags and deleted cases listed.

**Exempt lots.** A lot that changes no behaviour - a wording, a rename, a doc-only or a CHANGELOG-only
lot - has no red to prove. The orchestrator declares it in the brief and writes
`{ "tdd": "exempt: <reason>" }` to `.dialecte/lot.json` at the package root of the worktree; the gate's
`tdd` step passes with the reason and what the change touches ("exempt: <reason> (n production files, m
test files changed)"), the hand-over card shows the same. The file is never committed (the hygiene and the
hand-over leave it out). A lot that changes behaviour is never exempt, however small. A single case may be
accepted without a red instead - a new test of behaviour that already exists, an honest cut of an
assertion, a fix's new test whose red was taken on the previous round's snapshot (Station 4; the reason quotes
that red): `"accept": [{ "case": "<file>::<name> [project]", "reason": "..." }]` in the same file
(`dialecte lot accept <case> <reason>` writes it from cli 0.2.0). It
passes `tdd red` as accepted, does not block its file, and the gate and the card list it with its
reason.

One agent playing every station (no sub-agents) keeps the same order and the same commands.

Before touching code (the implement station; the test station does the same before its tests):

1. Read the brief. Check it against the code as it is now: a brief written before an earlier lot landed
   can assume things that changed. A contradiction stops you: say it, do not reinterpret the plan.
2. `git status -sb` in your worktree: right branch, clean (or dirty only with your own earlier work).
   Note the HEAD sha for your report.
3. Load `dialecte` and `dialecte-contributing`; run the reuse ladder before writing anything.

Then, within the step:

- **Red** is the test station's `tdd red` output: each case failed for the right reason - an assertion,
  not a missing module (the stub carries the real type). Its lines are the report's `Red seen`.
- **Green**: the minimum production code, one case after the other, until `tdd green` holds them all.
- A case that passes before any code is refused at `tdd red`: it proves nothing yet. Never show a red by
  breaking the code afterwards: the test goes back to the test station.
- Only the lot's scope. A refactor outside it is a new lot, said out loud.

A **skill text change** is code too: when the lot changes what a skill tells agents to do (a new command to
run, a rule), load `anthropic-skills:skill-creator` with the Skill tool and follow it. A skill change judged
by hand, or by the agent that wrote it, looks green on one run and its own reading; skill-creator's loop is
what shows the change moves behaviour. As it applies here: the eval case under the skill's `evals/` first
(it describes the behaviour the new text must produce; the text before the change fails it); runs with the
changed text and with the text before it (`git show <base>:skills/...` into the eval workspace), on the
standard and the strong tier, several runs per configuration, every run with the same tools; grading by a
separate agent that is not told which text produced a run; skill-creator's benchmark and viewer handed on
with the report. Then `skills:generate` and `skills:check`.

Report (exactly this shape):

```
Lot <id> done - <what it does, one line>
Base: <branch> @ <sha>
Files: <list>
Tests: <n> passing of <m> table cases - command: <the exact command, unfiltered>
Red seen: <the `tdd red` line of each case: case, kind, failing message>   (one line per behaviour)
Gates: <the lines `dialecte gate` printed, with their counts>; rules <n errors, m warnings>
Skill evals: <case: pass rate with / before, runs per configuration; benchmark and viewer paths>   | n/a
Deviations from the brief: <none | what and why>
Open questions: <none | ...>
```

## Station 2 - fast gate (the counts decide, not the summary)

Run `npx dialecte gate --fast --declare <new path>` and `npx dialecte rules` from the package root. The gate
starts with the worktree's hygiene (nothing staged, the stash as it was when the worktree was made, every new
file declared: one `--declare` per new file or folder of the lot), then runs each step unfiltered and prints
one line per step with the counts the step itself printed; paste those lines in the report. Fix every `rules` error before the review. The bullets below are what the gate checks for
you, and what you check by hand with a cli older than 0.2.0:

- Run every command that decides a gate **unfiltered**: an output-compacting shell wrapper can print a green
  summary for a run that tested nothing. Read the real summary line.
- **Zero tests, or no count, is a failed gate.** The passing count must reach the number of table cases you
  wrote; fewer means some never ran (a collect or type error in the test file).
- The type-check must cover the tests (the package's `check`, or its test tsconfig): a solution
  `tsconfig.json` checks nothing.
- A red run that does not fail is not red: fix the case before writing code.

The orchestrator checks the report shape before spawning the review: a report without `Red seen` lines or
with `Tests` not counted against the cases goes back to the implementer, not to the reviewer. The gate's
`tdd` step (after the hygiene) fails on a new or changed case without a red receipt and a later green one,
listing them: the missing receipts go back to the test station (no red) or the implementer (no green).

## Station 3 - review (independent)

The reviewer did not write the code and does not take the implementer's report as truth. Read-only.
Inputs: the brief (the spec), the diff of the lot's files, the previous version of each file, the rules
(`dialecte-contributing` code rules and Definition of Done, `dialecte` reuse ladder).

**Pass 1 - correctness** (always first): logic, edge cases, async and error handling, a behaviour changed
without a test, a test that passes for the wrong reason (weak assertion, a matcher that ignores what the
spec cares about, an XPath matching another element), types that the next lot cannot use without casts,
a contradiction with the brief or the plan. An exempt lot: does its reason match the diff (a "wording"
lot that changes an expected value or a production branch is not exempt)? Each accepted case: does its
reason match the diff (the behaviour really exists at the base, the cut really removes a wrong assertion, a red
on `round-<n>/` is the one the fix report holds, with its failing line)?
Each flag the gate prints: why it happened.

**Pass 2 - fit**: does it do what the brief said, no more; did it hand-roll something the API, a hook or
a helper already provides (name the existing method); the code rules (named functions, object
parameters, `*.types.ts` / `*.constants.ts`, no nested `await`, full names, no `any`); docs, CHANGELOG
and skills updated in the same lot; generated files untouched; a hand-written commit or merge script in the
hand-over is a finding (hand-overs go through `dialecte handover`, which writes the folder and its card), not a
script to review line by line. Three findings that matter beat ten that do not.

### Rounds

Each round is a **fresh agent** (unanchored by the previous verdict) and each finding carries a severity:
**blocking**, **should fix** or **nit**.

**Risk class.** How many rounds a lot gets, and what the last one still acts on, follow what a wrong change would
break:

| Risk class                    | The lot changes                                                                                                              | Rounds | Last round acts on    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------- |
| shipped runtime or public API | code a consumer runs or imports from a package's public exports other than its test entry, its command line, or their docs   | 3      | blocking + should fix |
| test API or internal code     | a test entry other packages' suites import (`@dialecte/core/test`), skill text and its evals, or modules no consumer reaches | 2      | blocking + should fix |
| guards and tooling            | a guard (a source-scan test, a code rule), scripts, configs, the repository's own tooling                                    | 2      | blocking only         |

A lot that touches several classes takes the first row of the table it touches; a doubt between two rows takes the
upper one. The orchestrator declares the class, with the files that set it, at the top of the findings ledger
before round 1, and every reviewer brief names the round as `round <n> of <rounds>`. A finding keeps its severity
whatever the round: a fix found wrong, or a row a later fix reopened, carries the severity of the row it breaks,
and the last round acts on it even below its floor (a broken fix is never logged and left in the lot).

**Before round 1** the orchestrator creates the lot's hand-over folder, `_commit-plan/<topic>-<yyyy-mm-dd>/`
(outside every repository; `lots.json` lands there at Station 6), with a `findings-ledger.md` holding only the risk
class. **When it spawns round n** it snapshots the tree that round reviews into `round-<n>/` in the same folder: a
copy of every file `git status --porcelain -z --untracked-files=all` lists at the worktree root as changed or
untracked, at its path relative to the repository root, and beside it `round-<n>.deleted`, NUL-separated, naming
each deleted file and the old path of each rename (beside the copy, never in it: it is no file of the lot). A copy,
not a patch: nothing to apply, binary files included. The lot stays uncommitted until the hand-over, so HEAD is the
base for the whole loop: these snapshots are the only refs the later rounds have. From cli 0.2.0,
`dialecte record snapshot <folder> --round <n>` takes it (and `dialecte review delta` reads it); the text here is
the manual fallback for an older cli.

- **Round 1 - full review**, blind to the implementer's conclusions, every severity. The checklist, each angle
  answered even when empty: correctness; test soundness (each test fails for the right reason); **the
  consumer's view** - build the package and read what a consumer receives: the built `dist`, the emitted
  `.d.ts`, the docs (a fix that worked from sources was a no-op for every consumer once the bundler copied the
  dependency into `dist`; only the reviewer who built the package saw it); the code rules; docs and
  CHANGELOG against the code.
- **Later rounds - delta review**, given the findings ledger. A round before the last reports blocking and should
  fix, nits optional: the orchestrator fixes such a nit in the lot or logs it as a follow-up, and records which in
  the findings ledger. The last round reports what its class acts on; anything below is logged as a follow-up, not
  fixed in the lot. A finding the last round acts on is fixed; the round that would verify the fix goes to the user
  (above). The floor rises so the rounds converge. The review has three parts:
  - (a) **Each fix verified on the old code.** From cli 0.2.0,
    `dialecte review delta <folder> --round <n> --worktree` makes the throwaway worktree holding `round-<n-1>/`
    (the fixer's, when it made one: Station 4, reused, never a second); with an older cli, the orchestrator makes one by hand on its own branch
    (never the lot's), copies the snapshot over it, removes its deleted files - the one place a `git rm` is
    allowed, never in the lot's worktree - and passes the path (`worktree prune` lists it after the lot):

    ```
    npx dialecte worktree add <repository> <lot-branch>-round-<n-1> --from <base>
    cp -R <folder>/round-<n-1>/. <throwaway>/
    git -C <throwaway> rm -q --pathspec-from-file=<folder>/round-<n-1>.deleted --pathspec-file-nul
    ```

    The reviewer copies the fix's new test file in and runs it: it must fail there and pass in the lot's
    worktree. Without a throwaway worktree the reviewer reads the snapshot and says the guard was **reasoned,
    not run**; the ledger keeps that word (`fixed <n> (reasoned)`), never a plain `fixed <n>` for a guard
    nobody ran.

  - (b) **Only the fix diff and its blast radius**, starting from the fixer's blast-radius line of each fix
    (Station 4, copied into the ledger): does the fix widen, exclude or replace more than its finding needed, and
    does it reopen a row it did not name (a fixed exclusion that is now too wide, an earlier fix it replaced)?
    Then the diff, per file of either snapshot or of the lot now, read-only. `--no-index` exits 1 on
    differences and on a missing side alike, so pick the form by where the file is:

    ```
    # in round-<n-1>/ and in the worktree
    git diff --no-index --no-color --no-ext-diff <folder>/round-<n-1>/<file> <worktree>/<file>
    # not in round-<n-1>/ and not in round-<n-1>.deleted: it was at the base then
    git -C <worktree> diff --no-color --no-ext-diff HEAD -- <file>
    # new since round n-1 and absent from the base, or listed in round-<n-1>.deleted
    git diff --no-index --no-color --no-ext-diff /dev/null <worktree>/<file>
    # in round-<n-1>/, gone from the worktree
    git diff --no-index --no-color --no-ext-diff <folder>/round-<n-1>/<file> /dev/null
    ```

  - (c) **One line naming what round 1 did not look at.**

**The findings ledger** (`findings-ledger.md` in the hand-over folder) is the lot's memory across rounds. Only the
orchestrator writes it, by hand or, from cli 0.2.0, with `dialecte record review` (a new row, `open`) and
`dialecte record decision` (the states `open`, `fix to verify`, `fixed <n> [note]`, `accepted`, `logged`). The
cli writes neither the risk-class line nor `reopened`, and its `fix to verify` carries no blast radius: write
those by hand, or keep the blast-radius lines in a fixes file beside the ledger. Reviewers propose rows. It
opens with the risk class (`Risk class: <class> - <rounds> rounds, last round acts on <floor>, a further round
only with the user - set by <files>`). One row per finding: id, round
raised, severity, file:line, state - `open`, `fix to verify - <blast radius>` (the fixer says fixed; its
blast-radius line comes with it), `fixed <n>` (n = the round that verified the fix; `fixed <n> (reasoned)` when the
guard was not run), `reopened <n> by <id>` (a later fix broke it again), `accepted <reason>`, `logged <follow-up>`.
Every reviewer reads it; a finding fixed or accepted is not raised again unless the fix is wrong. Outside every
repository, it is never committed nor caught by the hygiene.
Once the lots are committed, `worktree prune` lists the folder (it holds `lots.json` and `commit.sh` by then),
findings ledger and snapshots with it - the retro reads them first. An abandoned lot's folder has no `lots.json`,
so neither `prune` nor `handover list` sees it: keep it for the retro, or hand the user its removal command with
its absolute `cd`.

Report:

```
## Review - lot <id> (round <n> of <rounds>, <risk class>)
Scope: full | delta against round-<n-1>/     Not looked at by round 1: <one line>   (later rounds)
**Pass 1 (correctness)**
- <id> <severity> <file:line> - <what is wrong> - <why it matters>   | nothing
- <id> blast radius: <what the fix widens, excludes, replaces> - holds | <new id> (later rounds)
- <id> fix verified: <the guard> fails on round-<n-1>/, passes now (run | reasoned) | <what is wrong with the fix>   (later rounds)
**Pass 2 (fit)**
- <id> <severity> <file:line> - <finding>
**Proposed findings-ledger rows**: the new ids above; <id> -> fixed <n> | fixed <n> (reasoned) | fix wrong | reopened <n> by <id>
**Verdict**: approve | fix-then-repass (a finding at or above this round's floor open) | to the user (the last round, a finding it acts on open)
```

## Station 4 - fix mode

For each finding: **agree** (fix it, with a test when behaviour changed), **disagree** (one line why, do
not fix), or **needs the user** (it reopens a decision). Report per finding: fixed / disagreed / escalated.
You never drop a finding on your own: disagreements go back to the orchestrator, who sets each state in the
findings ledger (`fix to verify - <blast radius>`, `accepted <reason>`, `logged <follow-up>`, `reopened <n> by
<id>`) before the next round.

**Every fix reports its blast radius**, one line under its finding: what the fix widens (a pattern, a list, an
include, a type that now matches more), excludes (what it now skips or no longer accepts) or replaces (the earlier
code or fix it takes the place of), and which findings-ledger rows it touches - its own, and any other row whose
code it changes, an earlier fix above all. A fix that touches nothing else says so: `blast radius: none beyond
<id>`. The orchestrator copies the line into the ledger row (`fix to verify - <blast radius>`); the next round's
reviewer starts there. A fix's own new finding is the usual way a round fails to converge: a too-wide exclusion
that fixes one finding and hides another, a fix that undoes an earlier one.

**The red of a fix's new test comes from the tree the round reviewed, never from production put back.** Write the
test before the fix and take its red with `npx dialecte tdd red` while the code it pins is still the reviewed one.
When production already holds the fix, run the new test where the old code still lives: `npx dialecte review delta
<folder> --round <n+1> --worktree` (n = the round whose findings you fix; cli 0.2.0, else the orchestrator's
hand-made throwaway of Station 3 (a)) makes a throwaway worktree holding `round-<n>/` and prints its removal
command; copy the new test file in, with the test code it imports that the round changed, run it there - it must
fail on its assertion - and in the lot's worktree, where it passes. The report says the red was taken on
`round-<n>/`, with the failing line, so the orchestrator records the case as accepted with that reason (Station 1),
never as a test-first red. The throwaway's path and removal command go to the orchestrator: it is round n+1's
throwaway too (same branch), passed to that reviewer, removed after it. Never edit production code back to the old
behaviour, not even for one run: that red proves the test can fail, not that it came first, and `tdd` cannot tell
it from a test-first red (it flags `red after green` only when the case already had a green there).

```
<id> fixed | disagreed: <why> | needs the user: <the decision>
  blast radius: widens <...> | excludes <...> | replaces <...> | none beyond <id>; ledger rows: <id>, <id>  (fixed only)
  red: tdd red before the fix | on round-<n>/ (throwaway <path>): <failing line>  (fixed with a new test only)
```

## Station 6 - hand over

The `dialecte-contributing` landing rules apply. In a package with a mutation scope, run `dialecte mutants status`
before every hand-over and every merge: a `new` survivor or a `died` run blocks the card and the guard until it is
handled (`dialecte-contributing`, Mutation testing); the lot's own run still running blocks only a merge or a `gate`
lot (on a plain hand-over it is a `!`). Write only the lots file and run `npx dialecte handover
<lots.json>`: it writes the hand-over folder and prints its card. Never a hand-written script, nor a file per
commit. When the repository has a commit hook (`core.hooksPath`), rehearse first with `npx dialecte handover
run <folder> --rehearse`: a scratch clone holding your tree, the hooks folder and `node_modules`, so the hook
runs as it will for the user. Rehearse a heavy hook while another suite loads the machine, or at least note
the load at rehearsal time (`uptime`) after the card: a quiet rehearsal hides a time bound that fails under load.

**A check's result belongs to the tree it ran on.** From cli 0.2.0 every gate and hook result is recorded with
what it checked - the tree, the installed lock, the linked `file:` dependencies and the command - and a run with
the same key answers from that record instead of running again. A suite run on a tree that already passed it finds
nothing new; the repeats are what costs: a lot that merged once ran the same suite four times (lot rehearsal, lot
commit, merge rehearsal, merge commit). So:

- A second `gate` of the same mode on an unchanged tree runs its hygiene and `tdd` step (they read the worktree,
  not the tree), then answers the rest from its record (`reused: gate --full green on this tree ...`). Run it when
  you want its lines; never `--no-reuse` "to be safe": an edit, a lock, a linked dependency already make a new key.
  `--no-reuse` is for when the person asks, or when something outside the key changed (a machine fault you suspect).
- `handover run --rehearse` decides per lot and prints why (the rules: `dialecte-contributing`
  references/landing-changes.md). Paste those lines with the card; never add `--full` to force a rehearsal the cli
  skipped, and start no load for it. A lot it does rehearse runs under load as above.
- A merge onto a main that moved since the cut leaves a tree no check has seen: it is rehearsed. The branch's green
  records say nothing about it - not its suite, nor a gate step the hook does not run (docs, skills check, the
  browser suite). The rehearsal's hook runs the suite on the merged tree; run only the steps the hook does not run,
  in the clone `--rehearse --keep` leaves, never a `gate --full` that would run the suite there again. A `reused`
  line for such a merge is a cli bug to report, never a result to pass on.
- The real commit's hook always runs, whatever the records say: it is the person's last net. Nothing passes
  `--no-verify`.

The hand-over message to the user **is the card** `handover` printed - repository, worktree, branch, HEAD,
gates, the lots with their files and messages, and the command with its absolute `cd` - pasted as printed,
never retyped. After it: what was not verified, and one usage line (the lot's sub-agent tokens, in total
and by station: [references/retro.md](references/retro.md)). A refusal is a finding: fix the file or the
message, do not loosen the lots. `npx dialecte handover list` shows every hand-over waiting on the machine.
Never commit, push, stage, or touch a repository's index while a hand-over may be waiting.

## Station 7 - retro

Facts first, then improvements: [references/retro.md](references/retro.md). Every correction the user
made, every review round that found something an earlier station should have caught, every false green.
Each finding names the smallest change that prevents it and its category (skill, tooling, knowledge,
one-off). Skill edits are drafted as before/after and applied only with the user's approval; a skill
that is rewritten every retro never settles.

## Orchestrating with sub-agents

- One implementer per independent concern, **each in its own git worktree** cut from a committed base
  (never from uncommitted work), made with `npx dialecte worktree add <repository> <branch> [--from <ref>]`:
  it copies the hooks folder and `node_modules` and writes the hygiene baseline in one step. Never
  `git worktree add` plus copies by hand. Concerns that touch the same files are one implementer, or run in
  order.
- **After every agent hands back** (implementer, fixer), run `npx dialecte gate --fast --declare <new path>`
  in its worktree before anything else. Its hygiene step fails on a staged file or a stash added since the
  worktree was made, whatever wrote it. A failure is a finding: look with the read-only commands it prints
  and report it; never repair it with a git command that writes. When the agent changed nothing, the gate
  still runs its hygiene and `tdd` step and answers the rest from its record of that tree.
- Write each brief from [references/briefs.md](references/briefs.md): the brief is the agent's whole
  context; synthesise, do not say "based on the findings". Every brief carries its lines for all stations
  (nothing under `.git` by hand, no workflow without the user's opt-in, no `rm` on a variable path).
- Spawn the station's own agent when the host has it: Claude Code with `.claude/agents/dialecte-<station>.md`
  (written by `npx @dialecte/cli skills sync`: `dialecte-test-writer`, `dialecte-test-reviewer`,
  `dialecte-implementer`, `dialecte-implementer-strong`, `dialecte-reviewer`, `dialecte-fixer`,
  `dialecte-eval-runner`, `dialecte-grader`, `dialecte-standard-reader`, `dialecte-searcher`). The test
  writer edits tests and stubs; the test reviewer reads; the implementer keeps every edit tool, the freeze
  of the tests is `tdd green`'s and the gate's. The file sets the model and the tools (the reviewer cannot
  edit files), so the spawn names neither. Without the file, spawn a general sub-agent on the tier its brief
  names ([references/model-tiers.md](references/model-tiers.md)). Note the tokens of each completion notice
  against its station as it lands: the ledger the retro and the hand-over message report. When a station
  runs well above the lot's other stations, tell the user then, not at the end.
- Spawn the reviewer only after the implementer's report; give it the brief, not the implementer's
  conclusions. You review too: read the diff yourself before accepting a verdict.
- Runs use the runner's defaults, whoever else shares the machine: no `nice`, no worker cap added on the
  command line (a config's own setting, such as mutation tests' measured concurrency, is the runner's default), no
  `--no-file-parallelism`, no lock - unless the user asks to limit, for the time they say. A failing run is rerun
  once, the same command with its `--project` flags, on its failing files with `--no-file-parallelism` (the gate
  does it on its test steps): a pass
  there is a flake, a finding fixed at its cause, never a reason to throttle; a failure there is real
  (`dialecte-contributing`, Definition of Done).
- After the user merged: `npx dialecte worktree prune` lists the merged worktrees and branches, the
  committed hand-over folders and the rehearsal clones, each with its command (a worktree just made, one
  holding ignored files, an unmerged branch are kept, with why). `--yes` asks for a confirmation on a
  terminal and refuses without one: hand the printed commands, or the `--yes` command, to the user, each
  with its absolute `cd`. Never remove a worktree, a branch or a hand-over folder by hand.
- Never predict a sub-agent's result; wait for its report - up to its deadline (below), not forever.

### Deadlines

A completion notice comes only when a run ends: a run that hangs (a command waiting on its stdin, an agent
stuck in a loop) sends none, and waiting on the notice alone waits forever. So every agent and command the
orchestrator launches in the background gets a **deadline** when it is launched:

- **How long**: the station's deadline ([references/model-tiers.md](references/model-tiers.md)), or three
  times a duration measured on earlier runs of the same command (a commit hook, a gate, a bench: a hook that
  took 6 minutes gets 18). Write it in the run log.
- **Armed at launch**: in Claude Code, arm the check in the same turn as the launch - a scheduled check or
  a wake-up at the deadline, or a monitor on the run's log - so you are woken even if no notice comes. A host
  without one polls at the deadline.
- **At the deadline, look at the run itself**: its process tree (`pgrep -P <pid>`, `ps -o pid,stat,time,command`:
  is its CPU time growing?), the agent's last activity or the log's last line and its time, and `dialecte runs`
  once the cli has it (the live runs of the machine, each with its state).
- **Kill on what you see, never on the clock.** No new output and no CPU time gained by the tree since the
  last look: it is stuck - tell the user what you saw (the tree, the last line, since when) and stop or
  restart it. Still gaining CPU time or writing output: set one more deadline. Past that second deadline it
  is **over budget** (for a measured command 2 x 3 = 6x its duration, the point where the cli's coming budgets
  fail a run): report it to the user and go on watching; kill it only on silence.
  Under `dialecte handover run`, `gate` and `tdd`, the runner's own stall watchdog does the kill; your
  deadline is the backstop that notices a runner that did not.

## Never

- Skip the red step (`tdd red` from the test station), the test review, the review, or the cap.
- Let the implement station edit a test after its red, or prove a red by breaking the code afterwards.
- Name a model in a brief or a skill (name the tier), or down-tier a correctness review to save tokens.
- Commit, push, stage, or merge.
- `git stash` (one stash is shared by every worktree and session) and any git command that writes the index
  (`git add`, `git rm`, `git reset`, `git restore`, `git checkout --`; the one exception is the `git rm` of a review round's throwaway worktree). To compare with the base, read it with
  `git show <base>:<file>` or run it in a throwaway worktree; your own tree stays as it is.
- Edit, move or remove any file under a repository's `.git` folder by hand - a lock, a config, a receipt, a
  worktree's folder - even one your own run left, even when a refusal says "delete it and its lock". A stuck
  lock or a broken config stops that step: read it (`ls`, `cat`), then hand it to the orchestrator - its path,
  what you believe wrote it, the refused command; the orchestrator (or an agent playing every station) takes it
  to the user. The same for the hand-over script a lock names. Every station, every agent.
- Start a multi-agent workflow (Claude Code's Workflow tool) without the user's explicit opt-in: each sub-agent
  has its own spawn (Claude Code: the Agent tool), several at once when they are independent, eval runs included.
- `rm`, `mv` or `xargs` on a variable path: leave temporary files in the hand-over folder or the scratchpad.
- Wait on a background run with no deadline, or on its completion notice alone.
- Hand over a hand-written commit or merge script.
- Implement two lots in one station "because they are small".
- Reach for `any`, `@ts-ignore` or a skipped test to get green.
- Let an output live only in the chat.
