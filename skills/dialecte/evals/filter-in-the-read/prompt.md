---
tags: [dialecte]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

We build an app on a dialecte generated with @dialecte/create; our tests use @dialecte/core's own test dialecte (repository read-only at <dialecte-root>/core, where <dialecte-root> is the Dialecte checkout the eval runner points at; schema in src/test/generated/test.xsd: Root > A > AA_1 > AAA_1, each with a required attribute aX such as aAAA_1). Write `findByValue(query, { ancestor, value })` returning every AAA_1 element below a given element whose aAAA_1 equals `value`, for documents with tens of thousands of elements, and a table-driven test. Put the code, the test and a README.md explaining your choices in ./out/.
