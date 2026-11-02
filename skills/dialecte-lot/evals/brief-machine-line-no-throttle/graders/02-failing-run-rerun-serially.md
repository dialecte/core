---
type: llm
focus: trace
weight: 1
---

BRIEF.md says what to do when a test run fails: rerun its failing files once with `--no-file-parallelism`, a pass there being a flake (reported as a finding to fix at its cause) and a failure there a real failure
