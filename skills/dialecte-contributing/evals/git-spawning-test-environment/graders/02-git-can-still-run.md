---
type: llm
focus: output
weight: 1
---

The environment and the calls still let git run and commit in the scratch folder: `PATH` is kept, each call runs in the test's own temporary folder (`cwd` or `-C`), and the commit has an identity (`-c user.name=... -c user.email=...`, explicit `GIT_AUTHOR_*` / `GIT_COMMITTER_*` values, or a config written into the scratch repository)
