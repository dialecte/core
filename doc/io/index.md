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
const [{ documentId }] = await project.import([xmlFile], { configKey: 'scl' })

// 3. Work
const doc = project.openDocument(documentId)
await doc.transaction(async (tx) => {
	await tx.update(ref, { attributes: { name: 'new-name' } })
})

// 4. Export
const { xmlDocument } = await project.export(documentId, { withDatabaseIds: false })
```

## Schema-value materialization

The store is **faithful**: `standardizeRecord` canonicalizes attribute names, ordering, and namespaces on import, but it never fills in schema `required` / `fixed` / `default` **values**. An attribute the author omitted stays absent in storage, so `import` → `export` round-trips without injecting attributes that were never written. An attribute supplied with an empty (`''`) or `undefined` value is dropped at this boundary — an empty carries no information over the schema, so it is normalized away rather than stored.

Schema values are resolved only at the edges, from one source of truth ([`resolveSchemaAttributeValue`](/guide/development/utils#resolveschemaattributevalue)):

- **Read** — `getAttribute` / `getAttributes` surface an absent attribute's `fixed` or non-empty `default` (the `'optional'` [`defaults`](/api/query#schema-defaults-the-defaults-option) view). Pass `{ defaults: 'none' }` for the stored-only set.
- **Export** — `buildXmlDocument` materializes `required` (as `""` when no value) and `fixed` attributes on every element for XSD validity; optional `default`-only attributes are not reintroduced.

A write that sets an attribute to a value differing from its schema `fixed` is rejected with `FIXED_VALUE_VIOLATION` (`D3008`); import is unaffected, so an existing document that already violates a fixed value still loads.

## Low-level IO utilities

The lower-level building blocks are still exported for advanced use cases:

- `buildXmlDocument` - serializes raw records into an `XMLDocument`
- `parseXmlFile` / `ParseSession` - SAX-based streaming parser
- `downloadFile` - triggers a browser file download

## Extending IO

IO hooks let you run logic during the import pipeline without touching transactions. The primary use case is resolving cross-references that cannot be resolved incrementally during the SAX pass.

See [IO hooks](/io/hooks) for the full reference.

## Cross-realm reconciliation

A `Project` can be instantiated in more than one JS realm over the same persisted storage (e.g. an `iframe` running its own `Project`). Importing a document in one realm adds a per-document partition and bumps the store schema; other realms must catch up before they can read it.

The `Store` port carries this concern:

| Method                           | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `reconcile(documentId?)`         | Bring this connection in sync with persisted state (document registry + schema). |
| `isDocumentReadable(documentId)` | Read-only probe: can this connection serve the document's records right now?     |

Backend behaviour:

- **`DexieStore`** self-heals transparently: it listens for IndexedDB `versionchange` (fired when another connection upgrades the schema), releases its connection, and rebuilds it from the persisted schema version on the next access — so reads never throw a missing-partition error because of an import in another realm. `reconcile` performs this catch-up on demand.
- **`InMemoryStore`** is a no-op (its data is not shared across realms); readiness reduces to liveness. It warns once if `reconcile` is called.

`Project.getDocumentStatus` builds on these to report a document's [`live` / `ready`](/api/project#getdocumentstatus) status regardless of cross-realm signal ordering.

::: warning Custom stores
`reconcile` and `isDocumentReadable` are **required** members of the `Store` interface. A `{ type: 'custom' }` store must implement both — return a resolved no-op / liveness check when the backend has no cross-realm concern.
:::

## Further reading

- [IO reference](/io/xml) - `buildXmlDocument`, `parseXmlFile`, `IOConfig`
- [IO hooks](/io/hooks) - `beforeImportRecord`, `afterImport`
- [API overview](/api/) - Document, Query, Transaction
- [Transaction hooks](/api/hooks) - mutation lifecycle hooks
