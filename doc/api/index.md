---
description: Overview of the @dialecte/core public API - Project for multi-document lifecycle management, Document for per-file query/transaction access, and Query/Transaction interfaces for reading and mutating records.
---

# API Overview

The `@dialecte/core` API is organised around three concepts:

1. **Project** - multi-document container; owns the store, config registry, undo/redo, and IO lifecycle
2. **Document** - per-file entry point for querying records and running transactions
3. **Query / Transaction** - the read and write interfaces exposed by a Document

## Project

`Project` is the top-level container. Construct it sync, then call `.open(name)` async to connect the store.

```ts
import { Project, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const project = await new Project({
	configs: { test: TEST_DIALECTE_CONFIG },
	storage: { type: 'local' },
}).open('my-project')
```

Key methods:

| Method                        | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `project.open(name)`          | Async: connects store, hydrates state, returns `this`                       |
| `project.import(files)`       | Streams XML → IndexedDB partitions; returns `{ documentId, recordCount }[]` |
| `project.export(documentId)`  | Serializes IndexedDB partition → `XMLDocument`                              |
| `project.initEmptyDocument()` | Creates an empty document from config root element                          |
| `project.openDocument(id)`    | Returns a file-scoped `Document`                                            |
| `project.getDocuments()`      | List all registered document metadata                                       |
| `project.undo(documentId)`    | Undoes the last transaction for a document                                  |
| `project.redo(documentId)`    | Redoes the last undone transaction for a document                           |
| `project.destroy()`           | Drops the entire store and closes the channel                               |

See [Project reference](/api/project) for the full API.

## Document

`Document` is the per-file entry point. Obtained via `project.openDocument(documentId)`.

```ts
const doc = project.openDocument(documentId)

// Read
const root = await doc.query.getRoot()

// Write
await doc.transaction(async (tx) => {
	await tx.update(root, { attributes: { name: 'new-value' } })
})
```

See [Document reference](/api/document) for the full API.

## StorageParam

```ts
type StorageParam =
	| { type: 'local' } // built-in DexieStore (IndexedDB)
	| { type: 'inMemory'; writable?: boolean } // in-memory store (tests, demos, placeholders)
	| { type: 'custom'; store: Store } // bring your own Store implementation
```

## Extensions

The `extensions` constructor param accepts `{ base?, custom? }` — each is an `ExtensionModules` record mapping module names to `{ query?, transaction? }` objects. Core merges them and throws `DialecteError` (D6001) on method name collisions. See [Writing Extensions](/guide/extensions/) for the authoring guide.

## Further reading

- [Project](/api/project) — multi-document container, import/export, undo/redo, blobs
- [Document](/api/document) — lifecycle, state, transactions, prepare
- [Query](/api/query) — record lookup, descendants, attributes
- [Transaction](/api/transaction) — addChild, update, delete, deepClone
- [Hooks](/api/hooks) — transaction lifecycle hooks
- [IO](/io/) — low-level XML utilities and IO hooks
