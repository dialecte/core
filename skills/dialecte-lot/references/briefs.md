<!-- dialecte-skills workspace -->

# Briefs

A brief is everything a sub-agent knows. If you cannot write it clearly, you do not understand the lot
well enough to hand it off.

Every brief, whatever the station, carries these lines (the templates below assume them):

```
Never edit, move or remove a file under a repository's .git folder (a lock, a config, a receipt), even one
  your own run left, even when a refusal says to delete it: a stuck lock or config stops the step - read it,
  report its path, what you believe wrote it and the refused command to the orchestrator.
No multi-agent workflow (a host tool that fans out many agents at once) unless the user opted in; a sub-agent
  of yours has its own spawn. No rm, mv or xargs on a variable path: leave temporary files in the
  hand-over folder or the scratchpad.
Edit files with the edit tool. A script that rewrites a file reads it fully before it opens the file for
  writing, never both in one expression (opening for writing empties the file before the read).
Never run an ad-hoc script that writes files with a lot's worktree as its working folder: cd to the scratchpad
  or the hand-over folder first, and name a worktree file by its absolute path.
```

## Test-station brief

```
You are the test station (Station 1a of the dialecte-lot skill) of step <n> of lot <id> (<plan path>).
Tier: standard (model-tiers.md; `npx @dialecte/cli models` says which model). Station: test-writer (references/stations.md).

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
Tier: strong - never lower. Station: test-reviewer (references/stations.md).

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
Station: implementer | implementer-strong (references/stations.md).
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
Skills: load dialecte and dialecte-lot (and dialecte-contributing in a dialecte package). A skill text change: load the
  skill-creator skill (`anthropic-skills:skill-creator`; a host without it runs the loop below by hand) and
  follow it - eval case first, failing on the text
  before the change; runs with and before the change on the standard and strong tiers, several per
  configuration; graded blind by
  a separate agent, never by you; its benchmark and viewer paths in your report.
Gates: fast gate per behaviour; full Definition of Done once at the end (<the package's commands>).
Mutation (a dialecte package that declares a mutation scope; else no such line): <off | changed | gate | audit, set in .dialecte/lot.json>; once green (a gate lot: again after the last
  fix), `dialecte mutants run` in the background, survivors judged (`dialecte mutants judge --json`, then a
  test, `record` or `schedule`), `dialecte mutants status` before the report: no new survivor, no died run, a
  gate lot's run reported (dialecte-contributing, Mutation testing).
Machine: the runner's defaults (full parallelism, no nice, no lock); a failing run rerun once, the same command
  and --project flags on its failing files with --no-file-parallelism: a pass there is a flake to report as a
  finding, a failure there is real; limit only when the user asks.
Report: the implement report shape of dialecte-lot, nothing else.
```

## Reviewer brief

```
You review lot <id>, round <n> of <rounds> (<risk class>, from the findings ledger), as the review station of
the dialecte-lot skill. Read-only: modify nothing, no git command that writes in the lot's worktree.
Tier: strong, effort high, for both passes - never lower. Station: reviewer (references/stations.md).

Spec: <plan path + sections>; the implementer's brief: <inline or path> - not the implementer's conclusions.
Findings ledger: <hand-over folder>/findings-ledger.md (round 1: the risk class only), written by the
  orchestrator only. Raise nothing fixed or accepted there again unless the fix is wrong; propose rows, do not
  write the file.
Round 1 - full review, every severity. Diff: `git -C <worktree> diff <base>` and untracked files
  (`git status --porcelain`); compare each file with `git show <base>:<file>`. Answer each angle, even empty:
  correctness; test soundness (each test fails for the right reason); the consumer's view (build the package:
  run the build, then read the built dist, the emitted .d.ts, the docs - is the change there?); code rules;
  docs and CHANGELOG against the code.
Later rounds - delta review of the fix diff and its blast radius only. Start from each fix's blast-radius line in
  the findings ledger: does it widen, exclude or replace more than its finding needed, does it reopen a row it did
  not name? HEAD is still the base; the tree round n-1 reviewed is the snapshot
  <hand-over folder>/round-<n-1>/ (files at repository-relative paths, beside it round-<n-1>.deleted,
  NUL-separated). Fix diff, per file (`--no-index` exits 1 on differences and on a missing side alike): in both,
  `git diff --no-index --no-color --no-ext-diff round-<n-1>/<file> <worktree>/<file>`; not in round-<n-1>/ (at
  the base then), `git -C <worktree> diff --no-color --no-ext-diff HEAD -- <file>`, or /dev/null as the left
  side for a file the base does not have or that round-<n-1>.deleted lists; gone from the worktree, /dev/null as
  the right side (from cli 0.4.0, `dialecte lot delta <folder> --round <n>` prints that diff per file).
  Throwaway worktree: <path - from `dialecte lot delta <folder> --round <n> --worktree` (cli 0.4.0; the
  fixer's, when it made one), or made by the orchestrator with `dialecte worktree add <repository> <lot-branch>-round-<n-1> --from
  <base>`, round-<n-1>/ copied over, `git -C <throwaway> rm -q --pathspec-from-file=<folder>/round-<n-1>.deleted
  --pathspec-file-nul` | none>. Verify each fix: copy its new test file in and run it there - it must fail - and in
  the lot's worktree, where it passes; with none, read the snapshot and say the guard was reasoned, not run.
  One line naming what round 1 did not look at. Severity floor: a round before the last, blocking + should fix
  (nits optional); the last round, what the risk class acts on (blocking + should fix, or blocking only for
  guards and tooling). A wrong fix or a reopened row keeps the severity of the row it breaks.
Rules: the repository's code rules and Definition of Done (dialecte-contributing in a dialecte package), dialecte (reuse ladder).
Run (read-only): the tests of the lot, `skills check`, the type-check - report the real counts.
Check: every time bound of a test reading the disk, spawning a process or measuring time holds under load;
  a hand-written commit or merge script in the hand-over is a finding (it goes through `dialecte handover`).
Answer: would you approve? Use the review report shape, with a severity per finding and the proposed findings-ledger rows.
Max ~80 lines, most severe first, file:line for each finding.
```

## Fix-mode brief

```
Fix mode for lot <id> (round <n>). Findings: <the open rows of the findings ledger, verbatim, with id and severity>.
Station: fixer, or the implementer's own station (references/stations.md).
Tier: <standard for wording or naming findings | the implementer's tier otherwise> (resume the implementer
  when it is on that tier: its context is warm)
For each: agree (fix, test if behaviour changed) / disagree (one line why) / needs the user.
Blast radius, one line under each fix: what it widens, excludes or replaces (a pattern, a list, an include, a type
  now matching more or less; the earlier code or fix it replaces), and the findings-ledger rows it touches - its
  own and any other whose code it changes ("none beyond <id>" when so). The next round's reviewer starts there.
A fix's new test: write it before the fix and take its red with `npx dialecte tdd red`; when production already
  holds the fix, run it on round <n>'s tree - `npx dialecte lot delta <hand-over folder> --round <n+1>
  --worktree` (cli 0.4.0; else the throwaway I made: <path>) makes the throwaway and prints its removal command;
  copy in the test file and the test code it imports - where it must fail on its assertion, and report "red on
  round-<n>/: <failing line>" with the throwaway's path. Never edit production back to the old behaviour to get
  a red.
Never commit, stage, push, `git stash` (one stash is shared by every worktree and session) or any git command
  that writes the index; read the base with `git show <base>:<file>`.
Then the fast gate, and the report per finding.
```
