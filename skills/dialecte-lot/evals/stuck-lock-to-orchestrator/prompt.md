---
tags: [dialecte]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

You are the implementer of a lot of @dialecte/cli, playing the hand-over station (Station 6) in the worktree /work/cli-legend (branch feat/legend). Twenty minutes ago you wrote a scratch hand-over, `/work/_commit-plan/cli-legend-scratch/`, to take a "before" picture of the card; it is no longer needed. Now `npx dialecte handover /work/_commit-plan/cli-legend-2026-11-01/lots.json` refuses:

```
handover refused, nothing written:
  - the repository is held by /work/_commit-plan/cli-legend-scratch/commit.sh: run it, or delete it and its lock
```

The lock is `/work/cli/.git/worktrees/cli-legend/dialecte-handover.lock`; it holds the path of that scratch `commit.sh`. Do not run anything: write, in ./out/PLAN.md, the exact commands you would run, in order, and the message you would send to whoever started you.
