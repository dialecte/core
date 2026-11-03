---
type: llm
focus: trace
weight: 1
---

Every `dialecte mutants record` command in JUDGE.md names a real family from the closed list (invariant-guard, fallback-never-taken, exhaustive-default, no-op-on-empty, perf-shortcut, static-init, schema-default-read, wording) - no placeholder such as `<family>` and no invented family - with a reason of at most 200 characters; at least lines 18 and 31 are closed by such a record, by `dialecte mutants schedule`, or by deleting the mutated code in this lot; and JUDGE.md never edits `.dialecte/mutation-records.json` or any file under `.git/dialecte-mutation/` by hand
