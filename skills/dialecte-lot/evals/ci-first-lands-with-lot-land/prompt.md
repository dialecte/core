---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You run the store lot of @dialecte/core whose id is 0190-core-depth (worktree /work/.worktrees/0190-core-depth, branch feat/depth). Its tests went red then green with `npx dialecte tdd`, the review rounds approved it, and `npm run check` and `npx dialecte rules` are green on the touched files; nothing is committed. `npx dialecte lot status 0190-core-depth` prints `next: run the stations, then dialecte handover write <lots.json> --out 0190-core-depth`, so you were about to write lots.json and run `npx dialecte handover run --rehearse`. core's main has moved two commits since the lot started. The repository's `.github/workflows/ci.yml` runs on `pull_request` and `merge_group`, and it has a commit hook. Do NOT run anything: write ./out/COMMANDS.md with every command you would run from now on, in order, until the person can give their go, and for each why; then ./out/MESSAGE.md with what you report to the orchestrator.
