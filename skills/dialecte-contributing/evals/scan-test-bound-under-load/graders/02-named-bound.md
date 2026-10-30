---
type: llm
focus: trace
weight: 1
---

TEST-REVIEW.md asks for the bound as a named constant shared by such tests (core's `SOURCE_SCAN_TIMEOUT_MS` in `src/test/test-timing.constants.ts`, or a constant in a `*.constants.ts` file), not a bare number in the test
