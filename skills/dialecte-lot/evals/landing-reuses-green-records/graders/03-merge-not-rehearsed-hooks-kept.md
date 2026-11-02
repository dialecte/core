---
type: llm
focus: trace
weight: 1
---

For the merge onto the unmoved main, RUNS.md writes a merge hand-over and still runs `handover run <folder> --rehearse` on it (the run prints the merge's tree, which the merge lot needs), saying it runs no suite because the merge's tree is the branch tip's tree and the branch commit's records cover it; and both real commits (the lot, the merge) run the commit hook with its suite: nothing passes `--no-verify` or otherwise skips the hook
