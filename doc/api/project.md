---
description: API reference for the Project class - multi-document container managing config registry, store lifecycle, file registry, undo/redo, and document access.
---

# Project

`Project` is the top-level container that manages multiple documents backed by a single store. It owns the config registry, the shared `BroadcastChannel`, and per-document lifecycle.

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

Connects the store, hydrates existing file registrations into `project.state.documents`, and returns `this` for chaining. Accessing `project.name`, `project.store`, or `project.channel` before calling `open` throws `PROJECT_NOT_OPENED` (D7003).

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

Imports one or more XML files, streams each through SAX, and registers them as documents.

```ts
const results = await project.import([file1, file2], {
	configKey: 'scl',
	chunkOptions: { batchSize: 5000 },
})
// results: Array<{ documentId: string; recordCount: number }>
```

**ImportDocumentOptions**

| Param                 | Type                      | Default            | Description                                             |
| --------------------- | ------------------------- | ------------------ | ------------------------------------------------------- |
| `configKey`           | `string`                  | `defaultConfigKey` | Key into the configs registry                           |
| `metadata`            | `Record<string, unknown>` | -                  | Extensible per-file metadata                            |
| `chunkOptions`        | `Partial<ChunkOptions>`   | -                  | Override chunking defaults for SAX streaming            |
| `useCustomRecordsIds` | `boolean`                 | `false`            | Use IDs from XML attributes instead of generating UUIDs |

**Returns** `Promise<Array<{ documentId: string; recordCount: number }>>`

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

Each mutation broadcasts a corresponding `blob-added` / `blob-attached` / `blob-detached` / `blob-removed` event over the project's `BroadcastChannel` for cross-tab sync.

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

Each call broadcasts the change to other Document instances via `BroadcastChannel`.

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
project.close() // close store connection and BroadcastChannel
await project.destroy() // delete the database entirely and clear state
```

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
