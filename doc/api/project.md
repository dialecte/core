---
description: API reference for the Project class - multi-document container managing config registry, store lifecycle, file registry, undo/redo, and document access.
---

# Project

`Project` is the top-level container that manages multiple documents backed by a single store. It owns the config registry, the project `BroadcastChannel` (see [Project channel & events](#project-channel-events)), and per-document lifecycle.

## Creating and opening a Project

`Project` construction is split into two steps: a sync constructor that wires up config, then an async `open(name)` call that connects the store.

```ts
import { Project } from '@dialecte/core'

const project = await new Project({
	configs: { scl: sclConfig },
	storage: { type: 'local' },
	extensions: { base: sclExtensions, custom: myExtensions },
	hooks: sclHooks,
}).open('my-project')
```

**Constructor - `ProjectParams`**

| Param              | Type                                                     | Description                                                                            |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `configs`          | `Record<string, AnyDialecteConfig>`                      | Config registry keyed by label                                                         |
| `defaultConfigKey` | `string`                                                 | Used when `configKey` is omitted. Defaults to first key.                               |
| `storage`          | `StorageParam`                                           | `{ type: 'local' }`, `{ type: 'inMemory', writable? }`, or `{ type: 'custom', store }` |
| `extensions`       | `{ base?: ExtensionModules; custom?: ExtensionModules }` | Base and custom extension modules merged internally via `mergeExtensions`              |
| `hooks`            | `DialecteHooks`                                          | All lifecycle hooks (IO + record) applied to every Document — see [Hooks](/api/hooks)  |

**`project.open(name: string): Promise<this>`**

Connects the store, hydrates existing file registrations into `project.state.documents` (including each document's `canUndo`/`canRedo` from persisted history), and returns `this` for chaining. Accessing `project.name`, `project.store`, or `project.channelName` before calling `open` throws `PROJECT_NOT_OPENED` (D7003).

::: tip Dialecte packages
Higher-level dialecte packages (e.g. `@dialecte/scl`) expose a factory function (`createSclProject`) that pre-configures the `Project` constructor. Consumer code only calls `.open(name)`.
:::

## initEmptyDocument

Registers a new empty document with a root element pre-populated from the config's definition.

```ts
const documentId = await project.initEmptyDocument({
	name: 'untitled',
	extension: '.xml',
	configKey: 'scl',
})
```

**InitEmptyDocumentOptions**

| Param       | Type                      | Default                      | Description                          |
| ----------- | ------------------------- | ---------------------------- | ------------------------------------ |
| `name`      | `string`                  | `'untitled'`                 | Filename without extension           |
| `extension` | `string`                  | Config's first supported ext | File extension including leading dot |
| `configKey` | `string`                  | `defaultConfigKey`           | Key into the configs registry        |
| `metadata`  | `Record<string, unknown>` | -                            | Extensible per-file metadata         |

**Returns** `Promise<string>` - the new documentId.

## import

Imports XML files one after the other, in the order given, and returns one entry per file: imported, or failed with the error. A file that fails is its own entry, nothing of it lands, and the next file is still attempted. The call itself rejects only for what is about the call: an unknown `configKey` (`UNKNOWN_CONFIG_KEY`, checked before any file is touched) or a project not opened or closed (`PROJECT_NOT_OPENED`).

```ts
const entries = await project.import([file1, file2], {
	configKey: 'scl',
	chunkOptions: { batchSize: 5000 },
})
for (const entry of entries) {
	if (entry.status === 'failed')
		notifyFailed(entry.fileName, entry.error) // key, message, meta
	else if (entry.diagnostics.length) notifyDiagnostics(entry.fileName, entry.diagnostics)
}
const last = entries.findLast((entry) => entry.status === 'imported')
if (last) setActiveDocument(last.documentId)
```

**ImportDocumentOptions**

| Param                 | Type                      | Default            | Description                                             |
| --------------------- | ------------------------- | ------------------ | ------------------------------------------------------- |
| `configKey`           | `string`                  | `defaultConfigKey` | Key into the configs registry                           |
| `metadata`            | `Record<string, unknown>` | -                  | Extensible per-file metadata                            |
| `chunkOptions`        | `Partial<ChunkOptions>`   | -                  | Override chunking defaults for SAX streaming            |
| `useCustomRecordsIds` | `boolean`                 | `false`            | Use IDs from XML attributes instead of generating UUIDs |

**Returns** `Promise<ImportEntry[]>` - one entry per file, in the order given.

```ts
type ImportedDocument = {
	fileName: string // `file.name` as given
	documentId: string
	recordCount: number
	diagnostics: Diagnostic[] // what the import session had to say; `[]` when nothing
}

type ImportEntry =
	| ({ status: 'imported' } & ImportedDocument)
	| { status: 'failed'; fileName: string; error: DialecteError }
```

A failed entry's `error` is the structured error of what failed, as data: `PARSE_ERROR` for a malformed file, a dialecte's own error when one of its import hooks threw it, or `IMPORT_FAILED` wrapping anything else (a plain `Error` from a hook, a store that refused a write) - its `detail` the message, its `cause` what was thrown. An entry is plain data, `cause` excepted: the thrown `Error`, kept for a console, crosses a structured clone as a bare `Error`. `diagnostics` is an open union, `code: string`: narrow it to the catalogues you know with [`isKnownDiagnostic`](/io/hooks#diagnostics).

A project imports one file at a time: `import` and `importFile` calls made while another import runs wait for it, in call order, so two imports never interleave on the registry. `close()` and `destroy()` wait for the file in flight before closing, so it lands, is in the store and is broadcast; an `importFile` call made after `close()` rejects `PROJECT_NOT_OPENED`. In an `import` of several files, the project closed while one file is in flight means that file lands and the files after it are `failed` entries keyed `PROJECT_NOT_OPENED` - nothing of them is stored; the call itself still resolves with its entries.

## importFile

Imports one file: the imported document, or the failure thrown - for a caller that has one file and wants the throw.

```ts
const { documentId, recordCount, diagnostics } = await project.importFile(file, {
	configKey: 'nsd',
})
```

Same options as `import`. **Returns** `Promise<ImportedDocument>`. **Throws** what `import` would have put in the file's failed entry, as it was thrown: `PARSE_ERROR`, a hook's error, a store's error as is (`IMPORT_FAILED` is the entry's wrapping only). `import` is `importFile` in a loop with a `catch`: one code path.

**A document is whole or absent.** Files are imported one after the other, in the order given; each lands in `project.state` and is broadcast as soon as it is in. A file is registered with `status: 'importing'` before its first record is stored and set to `'ready'` once the last one is. Whatever fails in between - a malformed file (`PARSE_ERROR`, its `detail` naming what the parser saw and `meta.reason` saying `'malformed-xml'` or `'second-root'`), an import hook that throws, a store write that fails - removes the document again: `importFile` throws it, `import` makes it the file's `failed` entry and goes on with the next file. Nothing is broadcast for a failed file. A document still `importing` is never opened, listed or hydrated, here or in another tab. While it imports, a document says it is alive every `IMPORT_HEARTBEAT_MS` (2 s, `importingAt`); `open()` removes the ones whose heartbeat is older than `STALE_IMPORT_MS` (5 min - generous on purpose: a hidden tab's timers are throttled, and a false "dead" would lose a running import) - left by a tab that closed mid-import - and leaves a live import of another tab alone; an open project sweeps again every `STALE_IMPORT_MS`. Both constants are exported.

## export

Serializes a document's records back to XML.

```ts
const { xmlDocument, filename } = await project.export(documentId, {
	withDatabaseIds: false,
	withDownload: false,
})
```

**ExportDocumentOptions**

| Param             | Type      | Default | Description                                                                           |
| ----------------- | --------- | ------- | ------------------------------------------------------------------------------------- |
| `withDatabaseIds` | `boolean` | `false` | Include internal database IDs in exported XML                                         |
| `withDownload`    | `boolean` | `false` | Trigger a browser file download via the File System Access API (with anchor fallback) |

**Returns** `Promise<{ xmlDocument: XMLDocument; filename: string }>`

## File registry

```ts
// Get all registered file metadata
const files: DocumentRecord[] = await project.getDocuments()

// Get a single file's metadata
const file: DocumentRecord | undefined = await project.getDocument(documentId)

// Remove a file and all its records
await project.removeDocument(documentId)
```

`DocumentRecord.status` (`DocumentStatus`) is `'importing'` while a file's records are being stored and `'ready'` after; a record stored before the field existed reads as `'ready'`. `getDocuments` and `getDocument` never return an importing document.

## Document access

`openDocument` returns a file-scoped [Document](/api/document) for querying and mutating a specific file's records.

```ts
const doc = project.openDocument(documentId)
const root = await doc.query.getRoot()
```

`getDocumentConfig` returns the dialecte config for a specific file:

```ts
const config = project.getDocumentConfig(documentId)
```

## getDocumentStatus

`getDocumentStatus` reports whether a document is usable in **this** realm, reconciling the local store against persisted state first. It is the safe way to open a document whose id may have arrived out of band — before the document was registered in this realm — for example an `iframe`-hosted consumer that runs its own `Project` instance in a separate JS realm from the window that performed the import.

```ts
const { live, ready } = await project.getDocumentStatus(documentId)
if (ready) {
	const doc = project.openDocument(documentId)
	const { xmlDocument } = await project.export(documentId) // safe
}
```

**Returns** `Promise<{ live: boolean; ready: boolean }>`

| Field   | Meaning                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------- |
| `live`  | Registered in this realm — `openDocument` will not throw `DOCUMENT_NOT_REGISTERED` (D7002).             |
| `ready` | The store can serve the document's records — reads / `export` will not throw a missing-partition error. |

An unknown document returns `{ live: false, ready: false }` rather than throwing.

### Why this exists — cross-realm ordering

When a `Project` is instantiated in more than one JS realm over the same persisted storage, the realms coordinate through two independent, **unordered** signals:

- the **document registry**, synced over the project [`BroadcastChannel`](#project-channel-events) (`document-imported` / `document-removed`);
- the **active-document id**, synced by the host application out of band (e.g. a `storage` event).

Because they are not ordered, the active-document id can reach the other realm _before_ the import broadcast registered the document (`openDocument` throws `DOCUMENT_NOT_REGISTERED`); and even once the registry catches up, that realm's connection may predate the schema that added the document's partition, so a read throws a missing-partition error.

`getDocumentStatus` removes the dependency on signal ordering: it reconciles this realm against the **persisted** storage — the authoritative source, written before either signal fires (see [Cross-realm reconciliation](/io/#cross-realm-reconciliation)) — then reports `live` / `ready`. Callers branch on the result instead of catching; no retries, no reopening the project.

## Cross-document queries

`queryFirst` and `queryAll` run a query function across all registered documents.

```ts
// Stop at first match
const result = await project.queryFirst(async (query) => {
	return query.findOne({ tagName: 'Substation', attributes: { name: 'HV' } })
})

// Collect from all documents
const allRoots = await project.queryAll(async (query) => {
	return [await query.getRoot()]
})
```

Both methods iterate documents sequentially and expose the full typed query surface including extension methods.

## Blobs

Attach binary files (PDFs, images, etc.) to a project, document, or specific record. Blob metadata lives in a shared `_blobs` registry table; binary data is partitioned per document in `blob_{documentId}` tables (mirrors record partitioning) and is cleaned up when the owning document is removed.

```ts
// Add a blob owned by a document, optionally attached to specific records
const blobId = await project.addBlob(documentId, file, [
	{ documentId, recordRef: bay.id, attribute: 'docRef' },
])

// Standalone project blob (not linked to any record)
const standaloneId = await project.addBlob(documentId, file)
```

**`BlobRecord`**

| Field        | Type               | Description                                         |
| ------------ | ------------------ | --------------------------------------------------- |
| `id`         | `string`           | Blob identifier (UUID)                              |
| `documentId` | `string`           | Storage owner; binary lives in `blob_{documentId}`  |
| `name`       | `string`           | Original filename                                   |
| `mimeType`   | `string?`          | MIME type                                           |
| `size`       | `number?`          | Size in bytes (for UI display without loading data) |
| `createdAt`  | `number`           | Creation timestamp (ms since epoch)                 |
| `attachedTo` | `BlobAttachment[]` | Logical refs from XML records; empty = standalone   |

**`BlobAttachment`**

```ts
type BlobAttachment = {
	documentId: string // document the blob is referenced from
	recordRef: string // record id (e.g. element uuid) inside that document
	attribute?: string // optional attribute name carrying the filename
}
```

**Methods**

| Method                                          | Description                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `addBlob(documentId, file, attachedTo?)`        | Add a blob; returns the generated `blobId`                  |
| `getBlob(blobId)`                               | Returns `{ entry, data } \| undefined`                      |
| `getBlobsByDocument(documentId)`                | Metadata of every blob referenced by a document (no binary) |
| `getBlobsByRecord(documentId, recordRef)`       | Metadata of every blob referenced by a specific record      |
| `getStandaloneBlobs()`                          | Metadata of project-level blobs (empty `attachedTo`)        |
| `attachBlob(blobId, ref)`                       | Append an `attachedTo` reference (no-op if already present) |
| `detachBlob(blobId, { documentId, recordRef })` | Remove all matching references from `attachedTo`            |
| `removeBlob(blobId)`                            | Hard-delete: removes from `_blobs` and `blob_{documentId}`  |

Each mutation broadcasts a corresponding `blob-added` / `blob-attached` / `blob-detached` / `blob-removed` event (each carrying a `timestamp`) over the project's `BroadcastChannel` for cross-tab sync.

`getBlob` throws `STORE_BLOB_NOT_FOUND` (D1008) if the blob id is unknown.

## exportBlob

Fetch a blob from the store and optionally trigger a browser download. Mirrors `export(documentId)` for binary attachments.

```ts
const { entry, data, filename } = await project.exportBlob(blobId, {
	withDownload: true,
})
```

**ExportBlobOptions**

| Param          | Type      | Default | Description                                                                           |
| -------------- | --------- | ------- | ------------------------------------------------------------------------------------- |
| `withDownload` | `boolean` | `false` | Trigger a browser file download via the File System Access API (with anchor fallback) |

**Returns** `Promise<{ entry: BlobRecord; data: Blob; filename: string }>`

Throws `BLOB_NOT_FOUND` (D7004) if the blob id is unknown.

## Undo / Redo

Undo/redo is file-scoped and managed at the Project level:

```ts
await project.undo(documentId)
await project.redo(documentId)
```

Each call updates the document's shared `DocumentEntry` deterministically — `lastUpdate` plus `canUndo`/`canRedo` recomputed from the store's history — then broadcasts a `commit` message so other tabs converge.

## Project channel & events

Every mutation a Project or one of its Documents performs is announced on a `BroadcastChannel`. The channel is the project's public event contract.

```ts
project.channelName // `dialecte::project::${name}`

const channel = project.createChannel() // fresh BroadcastChannel on channelName; caller owns it
channel.addEventListener('message', (e) => {
	const message = e.data // ProjectChannelMessage
})
// ...
channel.close()
```

Internally the Project keeps two instances: a posting channel and a separate listening channel. The spec withholds a message only from the exact instance that posted it, so the listening instance also receives this tab's own posts (echo) — one handler folds every mutation source, local and cross-tab, into project state.

**ProjectChannelMessage**

Discriminated union; every payload carries a `timestamp`. Changing a member is a breaking API change.

```ts
type ProjectChannelMessage =
	| { type: 'commit'; documentId: string; timestamp: number }
	| { type: 'init-empty-document'; documentId: string; timestamp: number }
	| { type: 'document-removed'; documentId: string; timestamp: number }
	| { type: 'document-imported'; documentId: string; timestamp: number }
	| { type: 'blob-added'; blobId: string; documentId: string; timestamp: number }
	| { type: 'blob-attached'; blobId: string; ref: BlobAttachment; timestamp: number }
	| {
			type: 'blob-detached'
			blobId: string
			ref: { documentId: string; recordRef: string }
			timestamp: number
	  }
	| { type: 'blob-removed'; blobId: string; timestamp: number }
```

## state (ProjectState)

```ts
type ProjectState = {
	documents: Map<string, DocumentEntry>
	activeTransactions: number
}
```

`documents` maps each registered file's ID to its [DocumentEntry](/api/document#documententry-project-level). The map is kept in sync with the store's file registry.

## Lifecycle

```ts
await project.close() // wait for the imports in flight, close store connection and BroadcastChannel
await project.destroy() // wait for the imports in flight, delete the database entirely and clear state
```

Once `close()` or `destroy()` is called the project is closed: `import`, `importFile`, `openDocument`, `export`, the registry reads and the blob methods throw `PROJECT_NOT_OPENED`; an import that was in flight still lands.

## In-Memory Storage

Use `{ type: 'inMemory' }` for tests, demos, or UI placeholder documents that need a valid `Document` instance without IndexedDB.

```ts
const project = await new Project({
	configs: { scl: sclConfig },
	storage: { type: 'inMemory' },
}).open('test-project')
```

**Options**

| Param      | Type      | Default | Description                                                |
| ---------- | --------- | ------- | ---------------------------------------------------------- |
| `writable` | `boolean` | `true`  | When `false`, mutations throw `STORE_NOT_WRITABLE` (D1007) |

A non-writable in-memory store is useful as a **null-object placeholder** in UI frameworks: reads return empty results, writes throw loudly. This prevents silent failures when code accidentally mutates before a real document is loaded.

```ts
// Read-only placeholder for UI boot phase
const project = await new Project({
	configs: { scl: sclConfig },
	storage: { type: 'inMemory', writable: false },
}).open('placeholder')

const doc = project.openDocument(docId)
await doc.query.getRoot() // returns undefined (empty store)
await doc.transaction(async (tx) => { ... }) // throws STORE_NOT_WRITABLE
```

## Internal

`getDatabaseInstance()` exposes the native database instance. Return type is inferred from the storage choice - no cast needed for the default `local` storage:

```ts
// storage: { type: 'local' } -> return type is Dexie, inferred
const db = project.getDatabaseInstance()

// storage: { type: 'custom', store: myStore } -> return type is ReturnType<typeof myStore.getDatabaseInstance>
const db = project.getDatabaseInstance()
```
