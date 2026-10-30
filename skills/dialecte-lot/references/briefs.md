<!-- dialecte-skills workspace -->

# Briefs

A brief is everything a sub-agent knows. If you cannot write it clearly, you do not understand the lot
well enough to hand it off.

## Test-station brief

```
You are the test station (Station 1a of the dialecte-lot skill) of step <n> of lot <id> (<plan path>).
Tier: standard (model-tiers.md; `npx @dialecte/cli models` says which model). Claude Code: dialecte-test-writer.

Step: <the 3-6 behaviours of the step, as case keys "<state> → <outcome>">
Spec: <the plan section(s), by path and heading; the decisions that bind it>
Read: this brief and the existing code only - not an implementation, not another agent's notes.
Worktree: <absolute path>, branch <branch>, base <sha>. Work only there. Never commit, stage, push,
  `git stash` or any git command that writes the index.
You may change: the test files of the step, and stubs - new exports with their real types whose body throws
  `new Error('not implemented: <name>')`. Never a behaviour of the production code.
Each test calls the code under test inside an `expect(...)` a matcher completes, so a stub's error is a
  red on the behaviour. Remove every `.only` and `only: true` before `tdd red` (it refuses a file holding one).
A test that reads the disk, spawns a process or measures time carries an explicit bound with wide slack,
  a named constant (core: `SOURCE_SCAN_TIMEOUT_MS` in `src/test/test-timing.constants.ts`), never the
  runner's default timeout.
Done when `npx dialecte tdd red` records a red for every case of the step; a refused case (passes, missing
  export, type or syntax error, timeout, stub at import or before the assertion) is fixed in the test.
Report: the `tdd red` output, unfiltered, and the list of stubs.
```

## Test-review brief

```
You review the tests (Station 1b of the dialecte-lot skill) of step <n> of lot <id>, before any code.
Read-only: modify nothing; `npx dialecte tdd status` is the one command to run.
Tier: strong - never lower. Claude Code: dialecte-test-reviewer.

Spec: <plan path + sections>; the step: <the behaviours>.
Read: the test code of the step - test files, and the helpers, fixtures and snapshots they changed
  (`git -C <worktree> diff <base> -- <test paths>` and the new ones) - not the stubs' callers, not the
  implementer's plans.
For each test: the behaviour of the brief it pins; a plausible wrong implementation and whether it fails the
  test (a weak matcher, an `expect(...)` without a matcher, an assertion on a stub's message, an
  expectation copied from a guess, a helper or snapshot that holds the expected value); a behaviour of the
  step without a test; a case of the base the change deletes; a test that reads the disk, spawns a process or
  measures time without an explicit bound with wide slack (a named constant, several times what it takes on
  a quiet machine): it passes alone and times out when another suite or a commit hook loads the machine.
Verdict: approve | back to the test station with the findings. Max ~50 lines, file:line for each finding.
```

## Implementer brief

```
You implement lot <id> of <plan path>, as the implement station of the dialecte-lot skill.
Tier: <standard for a mechanical or fully specified lot | strong for a design-heavy one> (model-tiers.md;
  `npx @dialecte/cli models` says which model; a failed round may go one tier up, said in the report)

Goal: <one sentence: the behaviour a user or caller gets>
Spec: <the plan section(s) to read, by path and heading; the decisions that bind it>
Worktree: <absolute path> (made with `dialecte worktree add`), branch <branch>, base <sha>. Work only there. Never commit, stage, push,
  `git stash` (one stash is shared by every worktree and session) or any git command that writes the index
  (`git add`, `git rm`, `git reset`, `git restore`, `git checkout --`): read the base with
  `git show <base>:<file>`.
Scope: <files / folders this lot may touch>; out of scope: <what a neighbour lot owns>
Reuse first: <existing functions, hooks, helpers you already know apply - name them>
Tests: written by the test station, red (`npx dialecte tdd status`), approved by the test review. Change
  production code only, until `npx dialecte tdd green`; a test you find wrong goes back to the test station
  with the reason. Never edit test code (tests, helpers, fixtures, snapshots): an edit after red is refused
  at green; if you made one, undo it by hand first (no git command), then hand the case back. Exempt lot: <none | the
  reason, written in .dialecte/lot.json by the orchestrator>
Skills: load dialecte, dialecte-contributing, dialecte-lot. A skill text change goes through skill-creator
  (eval case first, with/without run).
Gates: fast gate per behaviour; full Definition of Done once at the end (<the package's commands>).
Machine: one heavy browser run at a time; vitest --no-file-parallelism; nice -n 10.
Report: the implement report shape of dialecte-lot, nothing else.
```

## Reviewer brief

```
You review lot <id>, as the review station of the dialecte-lot skill. Read-only: modify nothing, no git
command that writes.
Tier: strong, effort high, for both passes - never lower.

Spec: <plan path + sections>; the implementer's brief: <inline or path>.
Diff: `git -C <worktree> diff <base>` and untracked files (`git status --porcelain`). Compare each file with
  `git show <base>:<file>`.
Rules: dialecte-contributing (code rules, Definition of Done), dialecte (reuse ladder).
Run (read-only): the tests of the lot, `skills check`, the type-check - report the real counts.
Check: every time bound of a test reading the disk, spawning a process or measuring time holds under load;
  a hand-written commit or merge script in the hand-over is a finding (it goes through `dialecte handover`).
Answer: would you approve? Use the review report shape: pass 1 correctness, pass 2 fit, verdict.
Max ~80 lines, most severe first, file:line for each finding.
```

## Fix-mode brief

```
Fix mode for lot <id> (round <n>). Findings: <the list, verbatim>.
Tier: <standard for wording or naming findings | the implementer's tier otherwise> (resume the implementer
  when it is on that tier: its context is warm)
For each: agree (fix, test if behaviour changed) / disagree (one line why) / needs the user.
Never commit, stage, push, `git stash` (one stash is shared by every worktree and session) or any git command
  that writes the index; read the base with `git show <base>:<file>`.
Then the fast gate, and the report per finding.
```
