---
type: llm
focus: output
weight: 1
---

COMMANDS.md does not run `npm run doc:build`, `npm run type-bench:check` or a second `gate --full` by hand besides `dialecte contrib` (those run inside contrib, which reuses what the full gate already passed on the same tree)
