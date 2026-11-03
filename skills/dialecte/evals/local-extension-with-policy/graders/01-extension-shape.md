---
type: llm
focus: output
weight: 1
---

The new verb lives in a local extension folder in the extension shape: a namespace folder holding `query/<verb>.ts` (one function), its types in a separate `*.types.ts` file, and an `index.ts` exporting an object with `query` (and `transaction`) that the app passes at project creation
