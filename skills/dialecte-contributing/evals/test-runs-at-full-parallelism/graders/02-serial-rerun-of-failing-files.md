---
type: llm
focus: trace
weight: 1
---

After the failures RUNS.md reruns only the two failing files (`src/store/hub/hub-client.test.ts`, `src/io/export/export-file.test.ts`) once, in the browser tier they failed in (`--project browser` kept, not a bare `vitest run <files>` that also runs other projects), with `--no-file-parallelism` (files one at a time), and calls the outcome: passing there = flaky in parallel, failing there = a real failure
