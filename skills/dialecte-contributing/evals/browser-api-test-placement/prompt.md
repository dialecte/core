---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

In @dialecte/core (a 0.8 branch; the worktree /work/core-quota is read-only and not available here) I write two new test files: `src/store/sqlite/quota-estimate.test.ts` reads `navigator.storage.estimate()` before and after a SQLite import, and `src/helpers/format-bytes.test.ts` tests the pure helper that formats those numbers. Where does each file go so the test suites pick it up, what do I declare (if anything), and which command runs each one alone while I iterate? Write ./out/ANSWER.md.
