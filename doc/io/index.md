---
description: Overview of the @dialecte/core IO layer - how Project.import, Project.export, and the low-level XML building/parsing utilities relate to the Document/Query/Transaction API.
---

# IO

Dialecte splits its surface into two layers.

## Two layers, one pipeline

| Layer       | Entry point                        | What it does                                                                                     |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Project** | `project.import`, `project.export` | Streams XML in/out of IndexedDB via the Project container.                                       |
| **API**     | `project.openDocument(id)`         | Opens a document backed by IndexedDB. All reads and writes go through `Query` and `Transaction`. |

They operate on the same IndexedDB store but at different times:

```
XML file
  +- project.import(file)            <- IO (SAX stream -> IndexedDB partition)
       +- project.openDocument(id)  <- API (IndexedDB -> Document)
             +- doc.query.*           (reads)
             +- doc.transaction()     (writes)
                   +- project.export(id)  <- IO (IndexedDB -> XMLDocument)
```

IO is stateless - it reads/writes the store directly without going through transactions. The API never reads from XML files - it always operates on an already-imported database partition.

## Typical workflow

```ts
import { Project } from '@dialecte/core'

// 1. Create and open project
const project = await new Project({
	configs: { scl: sclConfig },
	storage: { type: 'local' },
}).open('my-project')

// 2. Import
const { documentId } = await project.import(xmlFile, { configKey: 'scl' })

// 3. Work
const doc = project.openDocument(documentId)
await doc.transaction(async (tx) => {
	await tx.update(ref, { attributes: { name: 'new-name' } })
})

// 4. Export
const { xmlDocument } = await project.export(documentId, { withDatabaseIds: false })
```

## Low-level IO utilities

The lower-level building blocks are still exported for advanced use cases:

- `buildXmlDocument` - serializes raw records into an `XMLDocument`
- `parseXmlFile` / `ParseSession` - SAX-based streaming parser
- `downloadFile` - triggers a browser file download

## Extending IO

IO hooks let you run logic during the import pipeline without touching transactions. The primary use case is resolving cross-references that cannot be resolved incrementally during the SAX pass.

See [IO hooks](/io/hooks) for the full reference.

## Further reading

- [IO reference](/io/xml) - `buildXmlDocument`, `parseXmlFile`, `IOConfig`
- [IO hooks](/io/hooks) - `beforeImportRecord`, `afterImport`
- [API overview](/api/) - Document, Query, Transaction
- [Transaction hooks](/api/hooks) - mutation lifecycle hooks
