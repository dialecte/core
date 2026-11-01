---
type: llm
focus: output
weight: 1
---

No git process of the test runs with an inherited `GIT_*` variable, the call inside `branchOf` included: the `GIT_*` keys are deleted from `process.env` before any case - in a setup file written to ./out/ (with how vitest loads it), a `beforeAll` or module-level code of the test file - so both the test's own `execFileSync('git', ...)` calls and `branchOf` run without them. A per-call `env` on the test's own calls only, with `process.env` left as is, fails this grader: `branchOf` would still inherit `GIT_DIR`
