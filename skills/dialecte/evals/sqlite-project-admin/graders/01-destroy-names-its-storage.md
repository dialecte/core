---
type: llm
focus: trace
weight: 1
---

`deleteWorkspace` deletes through the SCL factory's `destroyProject` with both the name and `storage: { type: 'sqlite' }`, without opening the project first; a `destroyProject({ name })` without a storage, or an open-then-destroy, fails this
