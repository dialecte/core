---
type: llm
focus: output
weight: 1
---

The test is table-driven with the dialecte package's test runner (for SCL `runSclTestCases` from the package's `/test` entry) and inline XML fixtures, calls the function directly with the source query, covers both the default and the product option, and names no store (the runner picks it; in Node, the in-memory store)
