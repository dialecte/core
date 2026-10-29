<!-- dialecte-skills workspace -->

# Briefs

A brief is everything a sub-agent knows. If you cannot write it clearly, you do not understand the lot
well enough to hand it off.

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
Red cases to start from: <the first 2-3 behaviours, as case keys "<state> → <outcome>">
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
Answer: would you approve? Use the review report shape: pass 1 correctness, pass 2 fit, verdict.
Max ~80 lines, most severe first, file:line for each finding.
```

## Fix-mode brief

```
Fix mode for lot <id> (round <n>). Findings: <the list, verbatim>.
Tier: <standard for wording or naming findings | the implementer's tier otherwise> (resume the implementer
  when it is on that tier: its context is warm)
For each: agree (fix, test if behaviour changed) / disagree (one line why) / needs the user.
Then the fast gate, and the report per finding.
```
