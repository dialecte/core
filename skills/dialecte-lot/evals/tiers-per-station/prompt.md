---
tags: [dialecte]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

I orchestrate sub-agents on the Dialecte repositories (checked out side by side in <dialecte-root>, the Dialecte checkout the eval runner points at; read-only for you). Next lot, fully specified in the plan (`plans/rename-limit.md`, section "Lot 3"): in @dialecte/core, rename the option `maxDepth` of `query.findDescendants` to `depth`, keeping `maxDepth` as a deprecated alias for one release, with its table cases, the doc page and a CHANGELOG line. The worktree is /work/core-rename on branch feat/rename-limit, base 4be1c07. The first review round already came back with two findings: a JSDoc sentence that still says "maximum depth", and a local variable still named `maxDepthValue`. Do not run any agent: write, in ./out/, the three briefs I give next - ./out/implementer.md (for the lot), ./out/reviewer.md (for the review) and ./out/fix-mode.md (for those two findings) - each saying which agent I should spawn for it.
