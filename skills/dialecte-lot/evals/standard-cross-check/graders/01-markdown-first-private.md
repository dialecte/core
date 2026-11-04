---
type: llm
focus: trace
weight: 1
---

PLAN.md converts the PDF to markdown before anyone reads it (markitdown, docling, pymupdf4llm or an equivalent converter), the readers work on that markdown with line references, and the converted file is kept outside the package repository (never committed)
