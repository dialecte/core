---
type: llm
focus: output
weight: 1
---

No git process of the test runs with an inherited `GIT_*` variable, the call inside `branchOf` included: the run ships code that deletes the `GIT_*` keys from `process.env` before any case - a setup file written to ./out/ together with the `setupFiles` entry to add to the existing vitest config (a "goes in" line, a note or a config snippet all count, and so does a "skip it if a registered file already clears them" note), a `beforeAll`, or module-level code of the test file - so both the test's own `execFileSync('git', ...)` calls and `branchOf` run without them. Failing it: shipping no clearing code because the suite "has one" (the run cannot see the config); a per-call `env` on the test's own calls only, with `process.env` left as is (`branchOf` would still inherit `GIT_DIR`); a whole replacement `vitest.config.ts` written without seeing the existing one
