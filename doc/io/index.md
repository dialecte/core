---
description: Overview of the @dialecte/core IO layer — how importXmlFiles and exportXmlFile relate to the Document/Query/Transaction API, and when to use each.
---

# IO

Dialecte splits its surface into two independent layers.

## Two layers, one pipeline

| Layer   | Entry point                       | What it does                                                                                     |
| ------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| **IO**  | `importXmlFiles`, `exportXmlFile` | Streams XML in/out of IndexedDB. No transactions.                                                |
| **API** | `openDialecteDocument`            | Opens a document backed by IndexedDB. All reads and writes go through `Query` and `Transaction`. |

They operate on the same IndexedDB database but at different times:

```
XML file
  └─ importXmlFiles()   ← IO layer (SAX stream → IndexedDB)
        └─ openDialecteDocument()  ← API layer (IndexedDB → Document)
              ├─ doc.query.*         (reads)
              └─ doc.transaction()   (writes)
                    └─ exportXmlFile()  ← IO layer (IndexedDB → XML file)
```

IO is stateless and standalone — it does not depend on a `Document` instance. The API never reads directly from XML files — it always operates on an already-imported database.

## Typical workflow

```ts
import { importXmlFiles, openDialecteDocument, exportXmlFile } from '@dialecte/core'

// 1. Import
const [databaseName] = await importXmlFiles({ files: [xmlFile], dialecteConfig })

// 2. Work
const doc = openDialecteDocument({
	config: dialecteConfig,
	storage: { type: 'local', databaseName },
})
await doc.transaction(async (tx) => {
	await tx.update(ref, { attributes: { name: 'new-name' } })
})

// 3. Export
const { xmlDocument } = await exportXmlFile({ dialecteConfig, databaseName, extension: 'xml' })
```

## Extending IO

IO hooks let you run logic during the import pipeline without touching transactions. The primary use case is resolving cross-references that cannot be resolved incrementally during the SAX pass.

See [IO hooks](/io/hooks) for the full reference.

## Further reading

- [IO reference](/io/io) - `importXmlFiles`, `exportXmlFile`, `IOConfig`
- [IO hooks](/io/hooks) - `beforeImportRecord`, `afterImport`
- [API overview](/api/) - Document, Query, Transaction
- [Transaction hooks](/api/hooks) - mutation lifecycle hooks
