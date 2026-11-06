---
type: llm
focus: trace
weight: 1
---

The project factories are made from the declaration only: no `engineUrl` or other worker URL is passed to `createProjectFactory` or to a project, no `spawner` or `spawners` is passed to `connectHub`, and the projects open with `storage: { type: 'sqlite' }`
