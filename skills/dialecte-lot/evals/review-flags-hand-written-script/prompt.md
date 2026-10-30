---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are the reviewer of a lot of a change of @dialecte/core (branch feat/integration, worktree /work/core-integration). The lot merges feat/opfs-c9b into core main. The implementer's report says: "Merge resolved by hand in 3 files (store/engine/host.ts, CHANGELOG.md, package-lock.json); tests green (4012 passing); hand-over: /work/\_commit-plan/core-integration-2026-10-30/merge.sh, which checks the worktree is clean, runs `git merge --no-ff feat/opfs-c9b`, copies the 3 resolved files from ./resolved/ over the conflicted ones, runs `git add` on them and `git commit --no-edit` (the hook runs the unit suite). Rehearsed once in a clone: green." The resolved files read correctly to you. Do NOT run anything: write ./out/REVIEW.md, your review report for this lot.
