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

| #   | Station     | Who                                     | Reads                                                                           | Leaves                                                                                                       |
| --- | ----------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0   | Orchestrate | orchestrator                            | the plan, the user's decisions                                                  | one brief per implementer (template in [references/briefs.md](references/briefs.md))                         |
| 1   | Implement   | implementer                             | its brief, the code it changes                                                  | code + tests, red first; an implement report                                                                 |
| 2   | Fast gate   | implementer                             | -                                                                               | `dialecte gate --fast` + `dialecte rules`: type-check, lint, format, touched tests, skills check, code rules |
| 3   | Review      | **a different agent** (strongest model) | the brief, the diff, the previous version (`git show <base>:<file>`), the rules | a review report: pass 1 correctness, pass 2 fit, verdict                                                     |
| 4   | Fix         | the implementer, fix mode               | the findings                                                                    | each finding fixed, disagreed (one line why) or escalated                                                    |
| 5   | Full gate   | implementer                             | -                                                                               | `dialecte gate --full`: the package's full Definition of Done, once per lot                                  |
| 6   | Hand over   | implementer or orchestrator             | the lot's files                                                                 | `dialecte handover`: a commit-by-lots script a human runs; nothing committed, nothing pushed                 |
| 7   | Retro       | orchestrator                            | reports, loops, the user's corrections                                          | retro entries; skill edits drafted, applied on approval                                                      |

Stations 3-4 loop on the same lot. **Cap: three review rounds.** A fourth round means the plan or the
brief is wrong - stop and bring the disagreement to the user. Re-review only the hunks that changed.

## Station 1 - implement (step mode)

Before touching code:

1. Read the brief. Check it against the code as it is now: a brief written before an earlier lot landed
   can assume things that changed. A contradiction stops you: say it, do not reinterpret the plan.
2. `git status -sb` in your worktree: right branch, clean (or dirty only with your own earlier work).
   Note the HEAD sha for your report.
3. Load `dialecte` and `dialecte-contributing`; run the reuse ladder before writing anything.

Then, one behaviour at a time:

- **Red**: one table case (`only: true`), run it, see it fail **for the right reason** - an assertion, not
  a missing module (stub the function with its real type first). Paste the failing line in your notes.
- **Green**: the minimum code. **Next case.** Remove every `only` at the end.
- **Green on the first run** means the case may be green by accident: break the code on purpose once and
  watch it fail.
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
Red seen: <case> failed with <assertion>   (one line per behaviour)
Gates: <the lines `dialecte gate` printed, with their counts>; rules <n errors, m warnings>
Skill evals: <case: with / without>   | n/a
Deviations from the brief: <none | what and why>
Open questions: <none | ...>
```

## Station 2 - fast gate (the counts decide, not the summary)

Run `npx dialecte gate --fast` and `npx dialecte rules` from the package root. The gate runs each step
unfiltered and prints one line per step with the counts the step itself printed; paste those lines in
the report. Fix every `rules` error before the review. The bullets below are what the gate checks for
you, and what you check by hand with a cli older than 0.2.0:

- Run every command that decides a gate **unfiltered**: an output-compacting shell wrapper can print a green
  summary for a run that tested nothing. Read the real summary line.
- **Zero tests, or no count, is a failed gate.** The passing count must reach the number of table cases you
  wrote; fewer means some never ran (a collect or type error in the test file).
- The type-check must cover the tests (the package's `check`, or its test tsconfig): a solution
  `tsconfig.json` checks nothing.
- A red run that does not fail is not red: fix the case before writing code.

The orchestrator checks the report shape before spawning the review: a report without `Red seen` lines or
with `Tests` not counted against the cases goes back to the implementer, not to the reviewer.

## Station 3 - review (independent)

The reviewer did not write the code and does not take the implementer's report as truth. Read-only.
Inputs: the brief (the spec), the diff of the lot's files, the previous version of each file, the rules
(`dialecte-contributing` code rules and Definition of Done, `dialecte` reuse ladder).

**Pass 1 - correctness** (always first): logic, edge cases, async and error handling, a behaviour changed
without a test, a test that passes for the wrong reason (weak assertion, a matcher that ignores what the
spec cares about, an XPath matching another element), types that the next lot cannot use without casts,
a contradiction with the brief or the plan.

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

The `dialecte-contributing` landing rules apply: write the lots file and run `npx dialecte handover
<lots.json>` (never a hand-written script when the command exists); give the absolute path and the one
command to run, the gates with real counts, what was not verified. A refusal is a finding: fix the file
or the message, do not loosen the lots. Never commit, push,
stage, or touch a repository's index while a hand-over script may be waiting.

## Station 7 - retro

Facts first, then improvements: [references/retro.md](references/retro.md). Every correction the user
made, every review round that found something an earlier station should have caught, every false green.
Each finding names the smallest change that prevents it and its category (skill, tooling, knowledge,
one-off). Skill edits are drafted as before/after and applied only with the user's approval; a skill
that is rewritten every retro never settles.

## Orchestrating with sub-agents

- One implementer per independent concern, **each in its own git worktree** cut from a committed base
  (never from uncommitted work). Concerns that touch the same files are one implementer, or run in order.
- Write each brief from [references/briefs.md](references/briefs.md): the brief is the agent's whole
  context; synthesise, do not say "based on the findings".
- Spawn the reviewer only after the implementer's report; give it the brief, not the implementer's
  conclusions. You review too: read the diff yourself before accepting a verdict.
- Heavy runs share one machine: one browser test suite at a time (`--no-file-parallelism`), low
  concurrency for mutation tests.
- Never predict a sub-agent's result; wait for its report.

## Never

- Skip the red step, the review, or the cap.
- Commit, push, stage, or merge.
- Implement two lots in one station "because they are small".
- Reach for `any`, `@ts-ignore` or a skipped test to get green.
- Let an output live only in the chat.
