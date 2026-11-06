---
type: llm
focus: trace
weight: 1
---

A dropped storage connection is told apart by the key `STORE_CONNECTION_LOST` (not `STORE_ENGINE_LOST`), and whether the write landed is read from that error's `meta.outcome` (applied / not-applied / running / unknown)
