---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate a lot of @dialecte/core (worktree /work/core-test-entry, branch fix/test-entry-types, base 6b15dec; hand-over folder /work/\_commit-plan/core-test-entry-2026-10-30/). The lot exports `XmlQueriesParams` and `XmlQueriesWithNamespacesParams` from `src/test/index.ts` (the `@dialecte/core/test` entry used by dialectes' test suites) and documents the order of `onTestFinished` in `src/test/create-test-project.ts`; nothing under the main `@dialecte/core` entry changes. The implementer's report and the fast gate are in. Do not run anything. Write ./out/FINDINGS-LEDGER.md as it stands before round 1, and ./out/REVIEWER-BRIEF.md, the brief for the round-1 reviewer.
