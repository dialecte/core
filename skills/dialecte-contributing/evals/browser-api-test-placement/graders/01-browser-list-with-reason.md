---
type: llm
focus: trace
weight: 1
---

ANSWER.md adds a `{ path, why }` entry for `quota-estimate.test.ts` to `BROWSER_ONLY_TEST_FILES` in `vitest.config.constants.ts`, the `why` naming the browser API it needs (`navigator.storage`, OPFS)
