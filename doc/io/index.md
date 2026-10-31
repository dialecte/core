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

| Member                                                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importFile({ file, options, writeId, onProgress, signal })` | Register the document `importing`, parse it with the dialecte's import session, store it batch by batch, apply the session's writes, set it `ready`. Answers `{ record, recordCount, diagnostics, perf? }`. Whatever fails, or an abort, leaves nothing and throws the structured error.                                                                                                                                                                                                                                                                                                                                                                         |
| `getWriteOutcome({ writeId })`                               | What became of an import or a commit asked by its id - after a lost connection, before reading again: `'running'` (an import under way), `'applied'` (an import whose document is ready; a commit once committed - also after its undo, and after a later commit discarded it - until its document is removed) or `'not-applied'` (refused, failed, aborted, never started, or its document removed since - a document a failed import left `importing`, its removal failed too, reads `'not-applied'` on the stores that see every import: in memory and SQLite; the local store reads it `'running'` until a store of the project opens again and removes it). |

- `writeId` is the caller's id for the import (generated when absent), kept on the document as `DocumentRecord.writeId`. A commit takes one too (`commit({ documentId, writeId, ... })`, generated when absent), kept on its history entry as `ChangeLogEntry.writeId`.
- `onProgress({ phase, bytesRead, totalBytes })` is told after each stored batch (`phase: 'storing'`) and never awaited: a listener that never answers, rejects or throws neither holds nor fails the import. A store that builds the document's indexes while it imports (the SQLite project store) also tells `phase: 'indexing'` before each index build and `'storing'` once it is built: the edits of other views wait while it says `indexing` (a few seconds on a 500 MB file), and land between its batches otherwise.
- `signal` aborts at the next batch: `IMPORT_ABORTED` (D5005), the document removed. Across a worker, where a signal cannot travel, the abort is a call of its own by `writeId`, and the listener an argument of its own.
- A store removes, as it opens, every document left `importing`: an import never outlives the store that ran it. The local store, which several tabs and frames open at once, keeps the imports another connection still runs: each import holds a Web Lock while it runs.

Every store runs the one pipeline core exports, `runImport(params, control)`:

```ts
import { runImport } from '@dialecte/core'

const result = await runImport(
	{
		store,
		runtime: { configs, defaultConfigKey, hooks, perf: true },
		file,
		options,
		writeId,
		perf: storePerf,
	},
	{ onProgress, signal }, // kept apart from the data, as a worker call carries them
)
```

`perf` (optional, `storePerf` above) is the `Perf` the import's stages are timed on, for a store whose target times stages of its own on it too (the SQLite project store's `import::encode`, `import::commit`, `import::index`); without it the import makes one from `runtime.perf`, and the result carries the snapshot when `runtime.perf` is on.

`store` is an `ImportTarget`: the reads and writes the import needs (`registerDocument`, `getDocument`, `removeDocument`, `bulkWrite` for the file's records), `writeSession(documentId, ops)` for the session's writes once every record of the file is stored (checked as `bulkWrite` checks them: a create of an id the file gave is refused `STORE_DUPLICATE_ID` as one the document holds - a store keeping no list of the ids its import made looks them up there) and `markReady(documentId)`, the one way a document becomes ready - once every record and write of its session is stored; refused `DOCUMENT_NOT_REGISTERED` when the document is no longer there `importing` (removed meanwhile, or another one registered since under its id). `updateDocument` takes no `status`, so a `Store` is not a target: a store passes its own, as `InMemoryStore` and the local store do, unguarded so its own import is not refused by a `close()` while it runs (an operation already running completes).

`runtime` (`StoreRuntime`) is what the store imports and exports with: the dialecte's configs, its hooks (IO and record), and `perf` to hand back the timings of each stage (a `PerfSnapshot`, merged by the project under `store::`). `InMemoryStore` and the local store take it as `runtime` (the project passes its own); a `{ type: 'custom' }` store imports with its own runtime, answers `getWriteOutcome` from its registry and its history (`writeOutcomeOf({ documents, writeId, committed, isRunning? })`, `committed` when a history entry - kept or discarded - carries the id, `isRunning` when the store knows which imports run: a document `importing` whose import does not run is then `not-applied`) and removes leftovers as it opens (`removeUnfinishedImports({ store, isRunning? })`, `isRunning` naming the imports another connection still runs). A store built without a runtime refuses `importFile` with `IMPORT_FAILED`.

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
- A record's value is written trimmed of XML whitespace (space, tab, carriage return, line feed) only: a no-break space or a byte order mark at its ends is written back; a value of XML whitespace only writes no text. A record holding a character XML does not allow (a control character below U+0020 but tab, line feed and carriage return, U+FFFE, U+FFFF) in what the writer copies - its value, namespace URI, attribute values and namespace URIs, tag name, prefixes, attribute names, and its id with `withDatabaseIds` - is refused with `XML_CHARACTER_NOT_ALLOWED` (`meta`: `recordId`, `tagName`, `attribute`, `part`, `character`), no file: XML can hold it neither as written nor as a character reference. A name is not otherwise checked as an XML name.
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

A store keeps plain JSON values only, in records, in document metadata and in blob entries (the entry an `addBlob` hands it, the reference an `attachBlob` adds): well-formed strings, finite numbers, booleans, `null`, and arrays and plain objects of them under well-formed keys, nested at most 512 levels counted from what a write hands: its list of records or patches, or the document (so an attribute's value may nest 508 levels, a metadata field's 510). The `Store` interface states this rule on each write member; every store checks what a write hands it before anything lands, through the one check core shares between its stores:

- A field holding `undefined` is dropped: it reads back absent. `updateDocument(id, { name: undefined })` leaves the name as it was, and `updateDocument(id, { metadata: undefined })` leaves the metadata: write the metadata you keep instead. A symbol key and a property that is not enumerable are dropped too, as JSON drops them (a `toJSON` method is refused, enumerable or not).
- Any other value is refused with `STORE_VALUE_NOT_JSON` (`D1015`): text or an object key that is not well-formed (it holds a lone surrogate, `!text.isWellFormed()`: SQLite holds text as UTF-8, which has no form for one, and would read it back changed), a `Date`, a `Map`, a `Set`, `NaN` or `Infinity`, a `BigInt`, a function, a symbol, an instance of a class, a raw JSON value (`JSON.rawJSON`: JSON would write its text), an object with a `toJSON` method (JSON would keep what it answers, not the object; it is never called), `undefined` in an array, a cycle, a value nested more than 512 levels deep. The write is refused whole; `detail` names the value and the field holding it (its own name, not its path).
- Every store refuses in the same order. A bulk write: a document not registered, a create that is not JSON, a taken id, then a patch that is not JSON (a patch of a record the document does not hold is skipped, whatever it holds). A commit: a document not registered or still importing, a `writeId` that is not well-formed text (it is kept on the commit's history entry), then an update of a record the document does not hold. A document registered: a taken id, then its values - so a `path` holding a lone surrogate is refused as a value, before the path rules. A document updated: its values - every key the update hands, also one it ignores (`id`, `extension`) - then the document looked up (one that is not registered is left alone).

Write a date as its ISO string or a number. A store keeps its own copy of what it is handed: a caller changing a value after the write does not change the store. Each value is read once, so hand values that read the same each time: a getter answering something new at each read is kept as it read for one store and may be read again by another.

Every store keeps well-formed text as written, code unit for code unit, and reads it back the same: a leading byte order mark (U+FEFF), NUL, U+FFFD, a surrogate pair, a decomposed letter (no normalisation). The SQLite project store too, though SQLite holds text as UTF-8: its text columns are decoded with the byte order mark kept, and a key holding a lone surrogate - a document's, a record's, a blob's or a tag name - is bound as bytes UTF-8 never holds, so it never reaches the document, record or blob whose key holds U+FFFD at that place. No store keeps such a key, so on every store it names nothing (IndexedDB data written before this rule may still hold one, and answers to it): a read answers as for a key not held (`undefined`, `[]`, `0`), a write is refused as one (`DOCUMENT_NOT_REGISTERED`, `STORE_BLOB_NOT_FOUND`, `STORE_RECORD_NOT_FOUND`) or touches nothing. The names a patch's `removeAttributes` lists are values: a patch of a held record removing a name that is not well-formed is refused. An imported file holding a character reference to a surrogate (`&#xD800;`, which XML forbids), or an import session saying a diagnostic that holds one, is refused the same way, nothing of the file kept.

A record is kept as its type has it: `id`, `tagName`, `namespace` (`prefix`, `uri`), `attributes`, `value`, `parent` (`id`, `tagName`, or `null`) and `children`. A field the object carries beyond those - at its top, in its namespace or in its parent - is dropped, once the whole record has passed the JSON check (a value that is not JSON is refused even there); attributes and children are kept as given. A bulk-write patch merged into a record keeps the same fields. A refused patch is named by its place among the patches that apply (those of records the document holds), however many the write hands.

## A document's path

A document's path is its place in the project: its folders, then its file name, joined by `/` (`substations/north.scd`). `parseDocumentPath({ path })` reads one apart into `{ folders, fileName }` and refuses, with `DOCUMENT_PATH_INVALID` (`D7030`, `meta.path` the path as given, `detail` naming the rule), a path that is not written the one way a path is written:

- relative, every folder and the file name non-empty: no leading or trailing `/`, no `//`;
- no folder or file name `.` or `..`;
- no backslash (a folder separator on Windows) and no character that is invisible or breaks a line in a tree: a control (Unicode Cc: U+0000-U+001F, U+007F-U+009F), a format character (Cf: a bidi override or isolate such as U+202E, which would show `north\u202Edcs.xml` as `northlmx.scd`, a zero-width character, the byte order mark) or a line or paragraph separator (Zl, Zp: U+2028, U+2029);
- well-formed UTF-16 (no lone surrogate) and in Unicode NFC (a name given in NFD, as macOS hands some, is normalised by the caller: `path.normalize('NFC')`);
- each folder or file name at most 255 UTF-8 bytes (`DOCUMENT_PATH_SEGMENT_MAX_BYTES`, what APFS, ext4 and NTFS take), the whole path at most 1024 (`DOCUMENT_PATH_MAX_BYTES`, macOS's `PATH_MAX`).

Nothing is rewritten: a path breaking a rule is refused, never normalised. A file name without an extension (`README`) is a valid form: whether a file name ends with the document's extension is checked against the document. The parts carry no name and extension split: a document's own `extension` says where its file name's extension starts (`.tar.gz`, or an extension without a dot), so read it from the document rather than splitting at the last dot. Names a file system of one platform refuses (`<>:"|?*` or `AUX` on Windows) and names that differ by case only are valid paths: whoever writes the files to such a system handles them.

Every store keeps a document's path as one fact with its name (`DocumentRecord.path`, [the project's view](/api/project#a-document-s-path)), and refuses in the same order. `registerDocument`: a taken id (`STORE_DUPLICATE_ID`), a value that is not JSON (`STORE_VALUE_NOT_JSON`), a path breaking a rule or not ending with the document's `name` + `extension` (`DOCUMENT_PATH_INVALID`), a place another document holds - the same path, or one a folder of the other's - (`DOCUMENT_PATH_TAKEN`, D7031). `updateDocument`: a value that is not JSON, then a document not registered is left alone, then the path rules, then the place; a key beyond `name`, `path` and `metadata` (`DOCUMENT_UPDATE_FIELDS`) is ignored - `status` too: only its import marks a document ready -, and a document's stored path is checked again only when the update gives a `path` or a `name` (a stored path a later rule refuses never blocks an update of its metadata). A path's file name is a `name` and an `extension` that are strings. `importFile({ options: { path } })` refuses a path before anything is registered: one breaking a rule, one whose file name has no extension after a name, one of an extension the config does not read. A custom store does the same with the helpers core's stores share:

- `assertDocumentPlace({ document, documents })` - a document to register: its path valid and naming its file, then its place free among `documents` (`{ id, path? }[]`, `PathHolderCandidate`; read them in the write's own transaction);
- `applyDocumentUpdates({ document, updates })` - the document with the updates applied, its name and path kept one fact (`DocumentUpdates`), refused `DOCUMENT_PATH_INVALID`; call `assertDocumentPlace` on the result when its path changed;
- `pathHolderOf({ path, documents, documentId? })` - the id of the document whose place clashes with `path`, `documentId` excepted.

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
- **`InMemoryStore`** is a no-op (its data is the realm's, shared by every in-memory store of the same project - its dialecte and its name - there, never across realms); readiness reduces to liveness. It warns once if `reconcile` is called.

`Project.getDocumentStatus` builds on these to report a document's [`live` / `ready`](/api/project#getdocumentstatus) status regardless of cross-realm signal ordering.

::: warning Custom stores
`reconcile` and `isDocumentReadable` are **required** members of the `Store` interface. A `{ type: 'custom' }` store must implement both — return a resolved no-op / liveness check when the backend has no cross-realm concern. It also implements `importFile`, `getWriteOutcome` and `exportFile`: see [Import inside the store](#import-inside-the-store) and [Export inside the store](#export-inside-the-store).
:::

## Further reading

- [IO reference](/io/xml) - `parseXmlDocument`, `parseXmlFile`, `IOConfig`
- [IO hooks](/io/hooks) - `beforeImport`, `createImportSession` (`beforeImportRecord`, `afterImport`, diagnostics)
- [API overview](/api/) - Document, Query, Transaction
- [Transaction hooks](/api/hooks) - mutation lifecycle hooks
