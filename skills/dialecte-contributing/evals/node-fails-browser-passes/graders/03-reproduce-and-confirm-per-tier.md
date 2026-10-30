---
type: llm
focus: trace
weight: 1
---

ANSWER.md reproduces the failure in node with `npx vitest run --project node <path>` (or `vitest run --project node <path>`) and, after the fix, confirms the file in both tiers (node, and the browser with `--project browser-all` or `npm run test:browser:all`)
