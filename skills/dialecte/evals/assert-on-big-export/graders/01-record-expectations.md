---
type: llm
focus: trace
weight: 1
---

TEST.md checks the big file with record expectations - tag, attribute values, parent, count - read through the query API (for example `findDescendants`, `getRecord(record.parent)`), not with XPath (`expectedQueries`, `document.evaluate`) over the whole exported document; it says why (a whole-document XPath on megabytes is slow)
