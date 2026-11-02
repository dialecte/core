---
type: llm
focus: trace
weight: 1
---

RUNS.md treats a flake (fails in parallel, passes serially) as a defect to report and fix at its cause (a time bound, a shared folder, port or file, browser state, an inherited environment variable), and does not answer it by running later suites niced, with fewer workers or files one at a time
