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

| #   | Station     | Who                         | Tier                                                        | Reads                                                                           | Leaves                                                                                                       |
| --- | ----------- | --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0   | Orchestrate | orchestrator                | strong                                                      | the plan, the user's decisions                                                  | one brief per implementer (template in [references/briefs.md](references/briefs.md))                         |
| 1a  | Test        | test station (own agent)    | standard                                                    | its brief step, the existing code                                               | tests + stubs, proven red by `dialecte tdd red` (its receipts)                                               |
| 1b  | Test review | **a different agent**       | strong                                                      | the tests of the step, the brief                                                | a verdict on the tests, before any code                                                                      |
| 1c  | Implement   | implementer (another agent) | standard or strong, by lot kind                             | its brief, the tests, the code it changes                                       | production code until `dialecte tdd green`; an implement report                                              |
| 2   | Fast gate   | implementer                 | no agent                                                    | -                                                                               | `dialecte gate --fast` + `dialecte rules`: type-check, lint, format, touched tests, skills check, code rules |
| 3   | Review      | **a different agent**       | strong, both passes                                         | the brief, the diff, the previous version (`git show <base>:<file>`), the rules | a review report: pass 1 correctness, pass 2 fit, verdict                                                     |
| 4   | Fix         | the implementer, fix mode   | standard for wording or naming, else the implementer's tier | the findings                                                                    | each finding fixed, disagreed (one line why) or escalated                                                    |
| 5   | Full gate   | implementer                 | no agent                                                    | -                                                                               | `dialecte gate --full`: the package's full Definition of Done, once per lot                                  |
| 6   | Hand over   | implementer or orchestrator | no agent                                                    | the lot's files                                                                 | `dialecte handover`: a hand-over folder and its card; a human runs it; nothing committed, nothing pushed     |
| 7   | Retro       | orchestrator                | strong                                                      | reports, loops, the user's corrections                                          | retro entries; skill edits drafted, applied on approval                                                      |

The Tier column names the kind of model a station runs on, never a model: the tiers, the rules that go with
them (escalate one tier after a failed round, never down-tier a correctness review, effort as a second knob)
and how to learn which model a tier is (`npx @dialecte/cli models`) are in
[references/model-tiers.md](references/model-tiers.md).

Stations 3-4 loop on the same lot. **Cap: three review rounds.** A fourth round means the plan or the
brief is wrong - stop and bring the disagreement to the user. Re-review only the hunks that changed.

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
assertion: `"accept": [{ "case": "<file>::<name> [project]", "reason": "..." }]` in the same file. It
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

A **skill text change** is code too: when the lot changes what a skill tells agents to do (a new command
to run, a rule), go through skill-creator's loop - add or update an eval case under the skill's
`evals/` first (it describes the behaviour the new text must produce; the current text fails it), edit
the skill, run the case with and without the skill, grade it. Then `skills:generate` and `skills:check`.

Report (exactly this shape):

```
Lot <id> done - <what it does, one line>
Base: <branch> @ <sha>
Files: <list>
Tests: <n> passing of <m> table cases - command: <the exact command, unfiltered>
Red seen: <the `tdd red` line of each case: case, kind, failing message>   (one line per behaviour)
Gates: <the lines `dialecte gate` printed, with their counts>; rules <n errors, m warnings>
Skill evals: <case: with / without>   | n/a
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
reason match the diff (the behaviour really exists at the base, the cut really removes a wrong assertion)?
Each flag the gate prints: why it happened.

**Pass 2 - fit**: does it do what the brief said, no more; did it hand-roll something the API, a hook or
a helper already provides (name the existing method); the code rules (named functions, object
parameters, `*.types.ts` / `*.constants.ts`, no nested `await`, full names, no `any`); docs, CHANGELOG
and skills updated in the same lot; generated files untouched. Three findings that matter beat ten that
do not.

Report:

```
## Review - lot <id> (round <n>)
**Pass 1 (correctness)**
- <file:line> - <what is wrong> - <why it matters>   | nothing
**Pass 2 (fit)**
- <file:line> - <finding>
**Verdict**: approve | fix-then-repass
```

## Station 4 - fix mode

For each finding: **agree** (fix it, with a test when behaviour changed), **disagree** (one line why, do
not fix), or **needs the user** (it reopens a decision). Report per finding: fixed / disagreed / escalated.
You never drop a finding on your own: disagreements go back to the orchestrator.

## Station 6 - hand over

The `dialecte-contributing` landing rules apply. Write only the lots file and run `npx dialecte handover
<lots.json>`: it writes the hand-over folder and prints its card. Never a hand-written script, nor a file per
commit. When the repository has a commit hook (`core.hooksPath`), rehearse first with `npx dialecte handover
run <folder> --rehearse`: a scratch clone holding your tree, the hooks folder and `node_modules`, so the hook
runs as it will for the user.

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
  and report it; never repair it with a git command that writes.
- Write each brief from [references/briefs.md](references/briefs.md): the brief is the agent's whole
  context; synthesise, do not say "based on the findings".
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
- Heavy runs share one machine: one browser test suite at a time (`--no-file-parallelism`), low
  concurrency for mutation tests. `gate --full` and the heavy gate steps (any test step of a package that
  runs its tests in a browser) hold a machine-wide lock: a second one waits, naming the holder.
- After the user merged: `npx dialecte worktree prune` lists the merged worktrees and branches, the
  committed hand-over folders and the rehearsal clones, each with its command (a worktree just made, one
  holding ignored files, an unmerged branch are kept, with why). `--yes` asks for a confirmation on a
  terminal and refuses without one: hand the printed commands, or the `--yes` command, to the user, each
  with its absolute `cd`. Never remove a worktree, a branch or a hand-over folder by hand.
- Never predict a sub-agent's result; wait for its report.

## Never

- Skip the red step (`tdd red` from the test station), the test review, the review, or the cap.
- Let the implement station edit a test after its red, or prove a red by breaking the code afterwards.
- Name a model in a brief or a skill (name the tier), or down-tier a correctness review to save tokens.
- Commit, push, stage, or merge.
- `git stash` (one stash is shared by every worktree and session) and any git command that writes the index
  (`git add`, `git rm`, `git reset`, `git restore`, `git checkout --`). To compare with the base, read it with
  `git show <base>:<file>` or run it in a throwaway worktree; your own tree stays as it is.
- Implement two lots in one station "because they are small".
- Reach for `any`, `@ts-ignore` or a skipped test to get green.
- Let an output live only in the chat.
