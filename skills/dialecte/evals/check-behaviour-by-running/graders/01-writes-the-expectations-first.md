---
type: llm
focus: trace
weight: 1
---

The expected state is written as a `dialecte run --expect` file - a JSON array of expectations ({ tag, where?, under?, count? }, e.g. AA_1 under A with a count) - before the run whose outcome answers the question, and is passed with --expect
