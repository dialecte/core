---
type: llm
focus: trace
weight: 1
---

STEPS.md runs the node tier per step (`npm run test:node` or `dialecte gate --fast`), the browser-only test list once per lot (`--project browser` or `dialecte gate --full`), and the whole suite in the browser (`npm run test:browser:all` or `--project browser-all` with no path) once before merge; all three must be present at those moments, and no `browser` or `browser-all` run happens per step or while iterating
