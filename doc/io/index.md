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
  +- project.importFile(file)        <- IO (SAX stream -> IndexedDB partition)
       +- project.openDocument(id)  <- API (IndexedDB -> Document)
             +- doc.query.*           (reads)
             +- doc.transaction()     (writes)
                   +- project.export({ documentId })  <- IO (store -> XML file)
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
const { documentId } = await project.importFile(xmlFile, { configKey: 'scl' })

// 3. Work
const doc = project.openDocument(documentId)
await doc.transaction(async (tx) => {
	await tx.update(ref, { attributes: { name: 'new-name' } })
})

// 4. Export
const { file, filename } = await project.export({ documentId })
```

## Schema-value materialization

The store is **faithful**: `standardizeRecord` canonicalizes attribute names, ordering, and namespaces on import, but it never fills in schema `required` / `fixed` / `default` **values**. An attribute the author omitted stays absent in storage, so `import` → `export` round-trips without injecting attributes that were never written. An attribute supplied with an empty (`''`) or `undefined` value is dropped at this boundary — an empty carries no information over the schema, so it is normalized away rather than stored.

Schema values are resolved only at the edges, from one source of truth ([`resolveSchemaAttributeValue`](/guide/development/utils#resolveschemaattributevalue)):

- **Read** — `getAttribute` / `getAttributes` surface an absent attribute's `fixed` or non-empty `default` (the `'optional'` [`defaults`](/api/query#schema-defaults-the-defaults-option) view). Pass `{ defaults: 'none' }` for the stored-only set.
- **Export** — the store's export writes the `required` (as `""` when no value) and `fixed` attributes an element does not hold, for XSD validity (on the root, those of each namespace the document declares); optional `default`-only attributes are not reintroduced.

A write that sets an attribute to a value differing from its schema `fixed` is rejected with `FIXED_VALUE_VIOLATION` (`D3008`); import is unaffected, so an existing document that already violates a fixed value still loads.

## Low-level IO utilities

The lower-level building blocks are still exported for advanced use cases:

- `parseXmlFile` / `ParseSession` - SAX-based streaming parser (`runImport` around it registers, finalizes and cleans up)
- `runExport` - the export every store runs (below)
- `parseXmlDocument` - the DOM of an exported file, in the page

## Extending IO

IO hooks let you run logic during the import pipeline without touching transactions. The primary use case is resolving cross-references that cannot be resolved incrementally during the SAX pass.

See [IO hooks](/io/hooks) for the full reference.

## Import inside the store

A store imports a file next to its data: `Project.importFile` hands the file to `Store.importFile` and keeps only the project state and the broadcast. A store behind a worker parses there, so records never cross into the page.

| Member                                                       | What                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importFile({ file, options, writeId, onProgress, signal })` | Register the document `importing`, parse it with the dialecte's import session, store it batch by batch, apply the session's writes, set it `ready`. Answers `{ record, recordCount, diagnostics, perf? }`. Whatever fails, or an abort, leaves nothing and throws the structured error. |
| `getWriteOutcome({ writeId })`                               | What became of an import asked by its id - after a lost connection, before reading again: `'running'`, `'applied'` (ready) or `'not-applied'` (failed, aborted, never started, or removed since).                                                                                        |

- `writeId` is the caller's id for the import (generated when absent), kept on the document as `DocumentRecord.writeId`.
- `onProgress({ bytesRead, totalBytes })` is told after each stored batch and never awaited: a listener that never answers, rejects or throws neither holds nor fails the import.
- `signal` aborts at the next batch: `IMPORT_ABORTED` (D5005), the document removed. Across a worker, where a signal cannot travel, the abort is a call of its own by `writeId`, and the listener an argument of its own.
- A store removes, as it opens, every document left `importing`: an import never outlives the store that ran it. The local store, which several tabs and frames open at once, keeps the imports another connection still runs: each import holds a Web Lock while it runs.

Every store runs the one pipeline core exports, `runImport(params, control)`:

```ts
import { runImport } from '@dialecte/core'

const result = await runImport(
	{ store, runtime: { configs, defaultConfigKey, hooks, perf }, file, options, writeId },
	{ onProgress, signal }, // kept apart from the data, as a worker call carries them
)
```

`store` is an `ImportTarget`: the reads and writes the import needs (`registerDocument`, `getDocument`, `updateDocument`, `removeDocument`, `bulkWrite`); every `Store` is one. A store that refuses operations once closed passes its own unguarded target, as `InMemoryStore` and the local store do, so its own import is not refused while it runs: an operation already running completes.

`runtime` (`StoreRuntime`) is what the store imports and exports with: the dialecte's configs, its hooks (IO and record), and `perf` to hand back the timings of each stage (a `PerfSnapshot`, merged by the project under `store::`). `InMemoryStore` and the local store take it as `runtime` (the project passes its own); a `{ type: 'custom' }` store imports with its own runtime, answers `getWriteOutcome` from its registry (`importOutcomeOf`) and removes leftovers as it opens (`removeUnfinishedImports({ store, isRunning? })`, `isRunning` naming the imports another connection still runs). A store built without a runtime refuses `importFile` with `IMPORT_FAILED`.

## Export inside the store

A store exports a document next to its data and answers one file: `Project.export` asks `Store.exportFile` and keeps only what the page adds (the DOM, the save). A store behind a worker writes the XML there; only the `Blob` crosses.

| Member                                                       | What                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exportFile({ documentId, options?, onProgress?, signal? })` | Read the document's records parent by parent, `batchSize` children per call, and write them as XML. Answers `{ file, filename, perf? }`: `file` a `Blob` of UTF-8 XML (`application/xml`), formatted or compact (`options.indent: false`). |

- `options`: `indent` (default `true`), `withDatabaseIds`, `batchSize` (records read per call and written per batch, `EXPORT_BATCH_SIZE` = 2000 by default; a whole number from 1, else `ASSERTION_FAILED`).
- The whole document is never read in one call: at most one batch per open element is held, whatever its width.
- A write on the document while it is exported (a commit, an undo, a redo, a bulk write, through any connection) restarts the export once from the start; a write in the second pass fails it with `EXPORT_CONFLICT` (D5006): export again. Commits are never held behind an export: the export yields between batches.
- `onProgress({ recordsWritten, totalRecords })` is told after each written batch and never awaited; a restart tells it from the start again. `signal` aborts at the next batch: `EXPORT_ABORTED` (D5007), nothing answered.
- A document not registered, or still `importing`, is refused with `DOCUMENT_NOT_REGISTERED`; one removed while it is exported too.
- `close()` while an export runs: the export completes; an export started after it is refused with `STORE_CLOSED`.

Every store runs the one export core exports, `runExport(params, control)`:

```ts
import { runExport } from '@dialecte/core'

const result = await runExport(
	{ source, runtime: { configs, defaultConfigKey, perf }, documentId, options },
	{ onProgress, signal },
)
```

`source` is an `ExportSource`: the store's reads (`getDocument`, `count`, `getMany`, `getByTagNameInDocument`) and `getExportVersion({ documentId })`, the number of writes the document has taken (`undefined` once it is not registered or not `ready`). A store bumps that version in the same transaction as every write, and passes its own unguarded source, as `InMemoryStore` and the local store do. A store built without a runtime refuses `exportFile` with `ASSERTION_FAILED`. With `perf`, the result carries the timings of `export`, `export::read`, `export::write` and `export::assemble`, merged by the project under `store::` ([Dev perf](/guide/development/dev-perf#export-stages)).

## Values a store keeps

A store keeps plain JSON values only, in records and in document metadata: strings, finite numbers, booleans, `null`, and arrays and plain objects of them. The `Store` interface states this rule on each write member; every store checks what a write hands it before anything lands, through the one check core shares between its stores:

- A field holding `undefined` is dropped: it reads back absent. `updateDocument(id, { name: undefined })` leaves the name as it was, and `updateDocument(id, { metadata: undefined })` leaves the metadata: write the metadata you keep instead. A symbol key and a property that is not enumerable are dropped too, as JSON drops them.
- Any other value is refused with `STORE_VALUE_NOT_JSON` (`D1015`): a `Date`, a `Map`, a `Set`, `NaN` or `Infinity`, a `BigInt`, a function, a symbol, an instance of a class, `undefined` in an array, a cycle. The write is refused whole; `detail` names the value and the field holding it (its own name, not its path).
- Every store refuses in the same order. A bulk write: a document not registered, a create that is not JSON, a taken id, then a patch that is not JSON (a patch of a record the document does not hold is skipped, whatever it holds). A commit: an update of a record the document does not hold first. A document registered: a taken id, then its values. A document updated: its values, then the document looked up (one that is not registered is left alone).

Write a date as its ISO string or a number. A store keeps its own copy of what it is handed: a caller changing a value after the write does not change the store.

## The SQLite project store's page cache

The SQLite project store sizes its page cache on the device's memory, as the browser reports it (`navigator.deviceMemory`, in a page and in a worker; a device that does not report it, Firefox for one, is sized as a 4 GiB one): 64 MiB per GiB, held between 64 and 512 MiB. The cache outside imports and the cache of an import follow the same rule. A worker's wasm memory never shrinks, so after a large import (826 MiB measured at 500 MB) the memory is already taken; above 512 MiB nothing is gained, and the SQLite build caps its memory at 2 GiB. Deleting a tenth of a 500 MB document takes about 10 s on a device given 64 MiB (1 GiB reported or less) and about 4.5 s at 512 MiB (8 GiB and more).

## Cross-realm reconciliation

A `Project` can be instantiated in more than one JS realm over the same persisted storage (e.g. an `iframe` running its own `Project`). Importing a document in one realm adds a per-document partition and bumps the store schema; other realms must catch up before they can read it.

The `Store` port carries this concern:

| Method                           | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `reconcile(documentId?)`         | Bring this connection in sync with persisted state (document registry + schema). |
| `isDocumentReadable(documentId)` | Read-only probe: can this connection serve the document's records right now?     |

Backend behaviour:

- **`DexieStore`** self-heals transparently: it listens for IndexedDB `versionchange` (fired when another connection upgrades the schema), releases its connection, and rebuilds it from the persisted schema version on the next access — so reads never miss the partition because of an import in another realm. `reconcile` performs this catch-up on demand.
- **`InMemoryStore`** is a no-op (its data is the realm's, shared by every in-memory store of the same name there, never across realms); readiness reduces to liveness. It warns once if `reconcile` is called.

`Project.getDocumentStatus` builds on these to report a document's [`live` / `ready`](/api/project#getdocumentstatus) status regardless of cross-realm signal ordering.

::: warning Custom stores
`reconcile` and `isDocumentReadable` are **required** members of the `Store` interface. A `{ type: 'custom' }` store must implement both — return a resolved no-op / liveness check when the backend has no cross-realm concern. It also implements `importFile`, `getWriteOutcome` and `exportFile`: see [Import inside the store](#import-inside-the-store) and [Export inside the store](#export-inside-the-store).
:::

## Further reading

- [IO reference](/io/xml) - `parseXmlDocument`, `parseXmlFile`, `IOConfig`
- [IO hooks](/io/hooks) - `beforeImport`, `createImportSession` (`beforeImportRecord`, `afterImport`, diagnostics)
- [API overview](/api/) - Document, Query, Transaction
- [Transaction hooks](/api/hooks) - mutation lifecycle hooks
