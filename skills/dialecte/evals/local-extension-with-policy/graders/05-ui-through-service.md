---
type: llm
focus: output
weight: 1
---

No component or composable calls `doc.query` or imports from `@dialecte/*` directly: the panel gets its rows from a service (document in, app shape out), and the extension imports nothing from the app's services, stores, policies or components
