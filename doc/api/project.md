---
description: API reference for the Project class - multi-document container managing config registry, store lifecycle, file registry, undo/redo, and document access.
---

# Project

`Project` is the top-level container that manages multiple documents backed by a single store. It owns the config registry, the project `BroadcastChannel` (see [Project channel & events](#project-channel-events)), and per-document lifecycle.

## Creating and opening a Project

`Project` construction is split into two steps: a sync constructor that wires up config, then an async `open(name)` call that connects the store.

```ts
import { Project } from '@dialecte/core'

const project = new Project({
	configs: { scl: sclConfig },
	storage: { type: 'local' },
	extensions: { base: sclExtensions, custom: myExtensions },
	hooks: sclHooks,
})
await project.open('my-project')
```

Keep the instance before opening it: when `open` is refused, that Project is the one that can reset the project (see [Lifecycle](#lifecycle)).

**Constructor - `ProjectParams`**

| Param              | Type                                                     | Description                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configs`          | `Record<string, AnyDialecteConfig>`                      | Config registry keyed by label                                                                                                                                                                                                              |
| `defaultConfigKey` | `string`                                                 | Used when `configKey` is omitted. Defaults to first key.                                                                                                                                                                                    |
| `storage`          | `StorageParam`                                           | `{ type: 'local' }`, `{ type: 'inMemory', writable? }`, `{ type: 'custom', store }`, or a kind an entry registers (`{ type: 'sqlite' }` after `import '@dialecte/core/sqlite'`, a dialecte's factory only): [Storage kinds](#storage-kinds) |
| `extensions`       | `{ base?: ExtensionModules; custom?: ExtensionModules }` | Base and custom extension modules merged internally via `mergeExtensions`                                                                                                                                                                   |
| `hooks`            | `DialecteHooks`                                          | All lifecycle hooks (IO + record) applied to every Document — see [Hooks](/api/hooks)                                                                                                                                                       |
| `dialecteId`       | `string`                                                 | The project's dialecte (a dialecte's project factory gives it): with the name, which project a store holds; read as `project.dialecteId`                                                                                                    |

**`project.open(name: string): Promise<this>`**

Connects the store, hydrates existing file registrations into `project.state.documents` (including each document's `canUndo`/`canRedo` from persisted history), and returns `this` for chaining. Accessing `project.name` or `project.channelName` before calling `open` throws `PROJECT_NOT_OPENED` (D7003).

::: tip Dialecte packages
A dialecte package exposes a factory function (`createSclProject` in `@dialecte/scl`) that pre-configures the `Project` constructor. The way to build one is `createProjectFactory` from the dialecte's declaration: every config, the default key, the extensions and a fresh hooks instance per project come from there, and consumer code chooses its storage and its own extensions, then calls `.open(name)`. See [Dialecte declaration](/api/dialecte).
:::

## Storage kinds

`storage.type` picks the store a project opens on. Core serves three kinds itself: `local` (IndexedDB, the default), `inMemory` (this page only) and `custom` (a `Store` you built). Every other type is a kind an entry registers: importing the entry adds the type to `StorageKinds` (a module augmentation, so `StorageParam` accepts it) and registers how a project of that type gets its store (`registerStorageKind`). `@dialecte/core/sqlite` registers `sqlite` ([SQLite Storage](#sqlite-storage)); a third-party package registers its own the same way ([Register a storage kind](/guide/development/implementing-a-store#register-a-storage-kind)).

```ts
import '@dialecte/core/sqlite' // registers `sqlite`: without it, `{ type: 'sqlite' }` is a type error

const project = await createSclProject({ storage: { type: 'sqlite' } }).open('my-project')
```

A type no kind is registered for in this realm is refused `PROJECT_STORAGE_NOT_REGISTERED` at `open` and at a factory's `destroyProject`, nothing opened: the entry that registers it was never imported, or a copy of `@dialecte/core` of another storage version registered it (a package bringing its own core) - align the core versions. A kind is shared by every copy of `@dialecte/core` of the same storage version in the page; the first registration of a type is kept, and another kind registered for it is refused `STORE_KIND_TAKEN`.

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

| Param       | Type                      | Default                      | Description                                          |
| ----------- | ------------------------- | ---------------------------- | ---------------------------------------------------- |
| `name`      | `string`                  | `'untitled'`                 | Filename without extension                           |
| `extension` | `string`                  | Config's first supported ext | File extension including leading dot                 |
| `configKey` | `string`                  | `defaultConfigKey`           | Key into the configs registry                        |
| `metadata`  | `Record<string, unknown>` | -                            | Per-file metadata, JSON values only                  |
| `path`      | `string`                  | -                            | Where the document sits ([path](#a-document-s-path)) |

With a `path`, `name` defaults to its file name less the extension and `extension` to the file name's (one the config reads, else `DOCUMENT_PATH_INVALID`); a `name` or `extension` given must make that file name.

**Returns** `Promise<string>` - the new documentId.

## import

Imports XML files one after the other, in the order given, and returns one entry per file: imported, or failed with the error. A file that fails is its own entry, nothing of it lands, and the next file is still attempted. The call itself rejects only for what is about the call: an unknown `configKey` (`UNKNOWN_CONFIG_KEY`, checked before any file is touched) or a project not opened or closed (`PROJECT_NOT_OPENED`).

```ts
const entries = await project.import([file1, file2], {
	configKey: 'scl',
	chunkOptions: { batchSize: 5000 },
})
for (const entry of entries) {
	if (entry.status === 'failed') notifyFailed(entry.fileName, entry.error) // key, message, meta
	else if (entry.diagnostics.length) notifyDiagnostics(entry.fileName, entry.diagnostics)
}
const last = entries.findLast((entry) => entry.status === 'imported')
if (last) setActiveDocument(last.documentId)
```

**ImportFilesOptions** (`importFile` takes `ImportDocumentOptions`: these and `path`)

| Param                 | Type                                      | Default            | Description                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `configKey`           | `string`                                  | `defaultConfigKey` | Key into the configs registry                                                                                                                                                                                                                                                                                                                    |
| `metadata`            | `Record<string, unknown>`                 | -                  | Per-file metadata, JSON values only ([values a store keeps](/io/#values-a-store-keeps))                                                                                                                                                                                                                                                          |
| `chunkOptions`        | `Partial<ChunkOptions>`                   | -                  | Override chunking defaults for SAX streaming                                                                                                                                                                                                                                                                                                     |
| `useCustomRecordsIds` | `boolean`                                 | `false`            | Use IDs from XML attributes instead of generating UUIDs                                                                                                                                                                                                                                                                                          |
| `onProgress`          | `(progress: ImportFilesProgress) => void` | -                  | Told at each phase of each file (`waiting`, `storing`, `indexing`, `processing`, `checking`, `applying`, `finishing`: [the phases](/io/#import-inside-the-store)), each report naming its file with `fileIndex` (from 0), `fileCount` and `fileName`; `importFile` tells the same reports without them. Never awaited, its failure reported once |
| `onFile`              | `(entry: ImportFileEntry) => void`        | -                  | `import` only: told as each file ends, with its entry (imported, or failed with its error) and its `fileIndex`; never awaited, its failure reported once                                                                                                                                                                                         |
| `signal`              | `AbortSignal`                             | -                  | Aborts the import at the next batch or step of the dialecte's `afterImport`: nothing of the file remains, `IMPORT_ABORTED`                                                                                                                                                                                                                       |

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

A failed entry's `error` is the structured error of what failed, as data: `PARSE_ERROR` for a malformed file, `IMPORT_ABORTED` (D5005) for an import aborted through `signal`, a dialecte's own error when one of its import hooks threw it, a store's refusal as it is (`STORE_VALUE_NOT_JSON` for a file holding text a store does not keep, such as `&#xD800;`), or `IMPORT_FAILED` wrapping anything else (a plain `Error` from a hook) - its `detail` the message, its `cause` what was thrown. An entry is plain data, `cause` excepted: the thrown `Error`, kept for a console, crosses a structured clone as a bare `Error`. `diagnostics` is an open union, `code: string`: narrow it to the catalogues you know with [`isKnownDiagnostic`](/io/hooks#diagnostics).

A project imports one file at a time: `import` and `importFile` calls made while another import runs wait for it, in call order, so two imports never interleave on the registry. `close()` and `destroy()` wait for the file in flight before closing, so it lands, is in the store and is broadcast; an `importFile` call made after `close()` rejects `PROJECT_NOT_OPENED`. In an `import` of several files, the project closed while one file is in flight means that file lands and the files after it are `failed` entries keyed `PROJECT_NOT_OPENED` - nothing of them is stored; the call itself still resolves with its entries.

## importFile

Imports one file: the imported document, or the failure thrown - for a caller that has one file and wants the throw.

```ts
const { documentId, recordCount, diagnostics } = await project.importFile(file, {
	configKey: 'nsd',
})
```

Same options as `import`, and `path`: where the document sits in the project ([a document's path](#a-document-s-path)) - it then takes its name and extension from the path's file name, not from `file.name`, and the extension must be one its config reads. `import` takes no `path` (`ImportFilesOptions`): a path names one file, and one handed anyway rejects the call with `DOCUMENT_PATH_INVALID` before any file is touched. **Returns** `Promise<ImportedDocument>`. **Throws** what `import` would have put in the file's failed entry: `PARSE_ERROR`, `IMPORT_ABORTED`, a hook's structured error, `IMPORT_FAILED` wrapping a plain `Error` (its `cause`). `import` is `importFile` in a loop with a `catch`: one code path.

**A document is whole or absent.** Files are imported one after the other, in the order given; each lands in `project.state` and is broadcast as soon as it is in. The import itself runs in the store, next to the data (`Store.importFile`, see [Import inside the store](/io/#import-inside-the-store)): the file is registered with `status: 'importing'` before its first record is stored and set to `'ready'` once the last one is. Whatever fails in between - a malformed file (`PARSE_ERROR`, its `detail` naming what the parser saw and `meta.reason` saying `'malformed-xml'` or `'second-root'`), an import hook that throws, a store write that fails, an abort - removes the document again: `importFile` throws it, `import` makes it the file's `failed` entry and goes on with the next file. Nothing is broadcast for a failed file. One exception: an import whose store lost its connection after the import landed is in the project all the same and broadcast, though refused (see [A lost connection](#a-lost-connection)). A document still `importing` is never opened, listed or hydrated, here or in another tab. An import never outlives the store that runs it: a document a closed tab left `importing` is removed when the store next opens. With `dev.perf` on, the timings of the import's stages land on `project.perf` under `store::import::*` ([Dev perf](/guide/development/dev-perf#import-stages)).

## export

Exports a document through the store: the store reads its records in batches next to the data and answers one file.

```ts
const { file, filename } = await project.export({ documentId })

// on the page: the DOM too (parse the compact file: one store export)
const { xmlDocument } = await project.export({ documentId, indent: false, xmlDocument: true })

// on the page: save the formatted file (the save dialog in Chrome, a download elsewhere)
await project.export({ documentId, download: true })
```

**ProjectExportParams**

| Param             | Type                              | Default | Description                                                                                                                                                                        |
| ----------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentId`      | `string`                          | -       | The document to export                                                                                                                                                             |
| `indent`          | `boolean`                         | `true`  | The layout of `file`: formatted (4 spaces, CRLF, a text value on its element's line) or compact                                                                                    |
| `withDatabaseIds` | `boolean`                         | `false` | Each element carries its record id as `_temp-idb-id` (`TEMP_IDB_ID_ATTRIBUTE_NAME`)                                                                                                |
| `xmlDocument`     | `boolean`                         | `false` | Also answer the DOM, parsed from the compact file with [`parseXmlDocument`](/io/xml#parsexmldocument): no whitespace-only text node                                                |
| `download`        | `boolean \| { filename: string }` | `false` | Also save the formatted file under the document's filename (or the one given); the save dialog is asked before the export runs, while the click still counts as the user's gesture |

**Returns** `Promise<{ file: Blob; filename: string; xmlDocument?: XMLDocument }>` - `file` is UTF-8 XML (`application/xml`); `xmlDocument` is typed present when `xmlDocument: true` is passed.

- One store export per call when the options agree; a second one when `xmlDocument` is asked with a formatted `file` (the DOM is parsed from the compact layout) or `download` with a compact one (the saved file is formatted). Two exports may see two states of the document if a commit lands between them: pass `indent: false` with `xmlDocument: true` to export once.
- The DOM and the save happen in the calling page; the store never builds them, so a store behind a worker exports the same way.
- A cancelled save dialog saves nothing and the call still answers; a dialog refused because the user's gesture lapsed falls back to a download of the formatted file; any other save failure is thrown. The browser may create the chosen file as the dialog closes: an export that then fails (`EXPORT_CONFLICT`, an abort) can leave it empty.
- A document not in the project throws `DOCUMENT_NOT_REGISTERED`; a commit on the document while it is exported restarts the export once, a second one throws `EXPORT_CONFLICT` (see [Export inside the store](/io/#export-inside-the-store)). A record holding a character XML does not allow throws `XML_CHARACTER_NOT_ALLOWED`, no file.
- The DOM equals the document the records make, element by element; its attributes also hold the namespace declarations written into the file (the root `xmlns` is an attribute of the xmlns namespace). The compact file writes a carriage return of a text value as `&#13;`, so the DOM keeps it (a raw one would be read as a line feed).

The formatted file is indented by depth; an element that holds text is written as is on its line, children included (`<Item>2025-08-04 10:59:16</Item>`): no whitespace is added to a value. A value is written trimmed of XML whitespace only (space, tab, carriage return, line feed): a no-break space or a byte order mark at its ends is written back. `getSnapshot({ as: 'xml' })` writes its XML the same way. The bytes are the same in every browser.

## File registry

```ts
// Get all registered file metadata
const files: DocumentRecord[] = await project.getDocuments()

// Get a single file's metadata
const file: DocumentRecord | undefined = await project.getDocument(documentId)

// Remove a file and all its records
await project.removeDocument(documentId)
```

### A document's path

`DocumentRecord.path` is where a document sits in the project: its folders, then its file name, joined by `/` (`substations/north.scd`). A folder tree reads it, whether the documents came one by one or from an archive. Its file name is always the document's `name` + `extension` - one fact, kept so by every store:

- `importFile(file, { path })` and `initEmptyDocument({ path })` place a document as it is registered, its name (and, for an import, its extension) taken from the path;
- the store's `updateDocument(id, { path })` moves and renames it (the name follows the file name, which must end with the document's own extension: a move never changes the format); `updateDocument(id, { name })` on a document with a path renames the file name in it, its folders kept; both given must agree;
- a path breaking a rule ([the rules](/io/#a-document-s-path)) or naming another file is refused with `DOCUMENT_PATH_INVALID` (D7030), nothing written;
- one document holds a place, and a document's path is never a folder of another's (`subs/north.scd` and `subs/north.scd/x.scd` cannot both be there): a clash is refused with `DOCUMENT_PATH_TAKEN` (D7031, `meta.takenBy` the document holding the place), nothing written. Paths compare exactly; a document without a path holds no place, and removing or moving a document frees its place;
- an export is named after the path's file name (`result.filename`, which is `name` + `extension`).

Moving and renaming go through the store (`updateDocument` on a store you hold, e.g. one given as a custom `storage`): the project has no member for it yet. On a store that announces its changes the project reads the record again and posts `document-updated`; on one that does not (`local`), `project.state` keeps the document as it was registered or imported, so its record - and `export({ download: true })`'s save dialog - keeps the old name until the project is opened again; `getDocument` reads the store.

`DocumentRecord.status` (`DocumentStatus`) is `'importing'` while a file's records are being stored and `'ready'` after; a record stored before the field existed reads as `'ready'`. `getDocuments` and `getDocument` never return an importing document. `DocumentRecord.writeId` is the id of the import that wrote the document - what [`Store.getWriteOutcome`](/io/#import-inside-the-store) is asked by.

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
	const { file } = await project.export({ documentId }) // safe
}
```

**Returns** `Promise<{ live: boolean; ready: boolean }>`

| Field   | Meaning                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`  | Registered in this realm — `openDocument` will not throw `DOCUMENT_NOT_REGISTERED` (D7002).                                                        |
| `ready` | The store can serve the document's records — reads / `export` see them, instead of the empty reads of a document the connection does not know yet. |

An unknown document returns `{ live: false, ready: false }` rather than throwing.

### Why this exists — cross-realm ordering

When a `Project` is instantiated in more than one JS realm over the same persisted storage, the realms coordinate through two independent, **unordered** signals:

- the **document registry**, told to the other realms as a change (`document-imported` / `document-removed`: by the store on `sqlite`, over the name's [`BroadcastChannel`](#project-channel-events) on `local`; an `inMemory` store tells only the Projects of its own page);
- the **active-document id**, synced by the host application out of band (e.g. a `storage` event).

Because they are not ordered, the active-document id can reach the other realm _before_ the import broadcast registered the document (`openDocument` throws `DOCUMENT_NOT_REGISTERED`); and, on `local`, even once the registry catches up, that realm's IndexedDB connection may predate the schema that added the document's partition, so a read answers empty (a document a connection does not know reads as absent: no records, a count of 0).

`getDocumentStatus` removes the dependency on signal ordering: it reconciles this realm against the **persisted** storage — the authoritative source, written before either signal fires (see [Cross-realm reconciliation](/io/#cross-realm-reconciliation)) — then reports `live` / `ready` (on `sqlite` one engine serves every view: there is nothing to reconcile, and `ready` is "registered"). Callers branch on the result instead of catching; no retries, no reopening the project.

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

Attach binary files (PDFs, images, etc.) to a project, document, or specific record. A blob belongs to one document and is removed with it. On `local`, blob metadata lives in a shared `_blobs` table and the binary in a `blob_{documentId}` table per document; on `sqlite`, the engine keeps every blob's bytes in one table, in chunks.

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
| `documentId` | `string`           | Owning document; the blob is removed with it        |
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
| `removeBlob(blobId)`                            | Hard-delete: the entry and its binary                       |

Each mutation is told as a `blob-added` / `blob-attached` / `blob-detached` / `blob-removed` event (each carrying a `timestamp`) on the project's channel (see [Project channel & events](#project-channel-events)).

`getBlob` throws `STORE_BLOB_NOT_FOUND` (D1008) if the blob id is unknown. A blob entry and an attached reference hold JSON values only ([values a store keeps](/io/#values-a-store-keeps)): `STORE_VALUE_NOT_JSON` otherwise.

## exportBlob

Fetch a blob from the store and, on request, save it. Takes one object, as `export` does.

```ts
const { entry, data, filename } = await project.exportBlob({ blobId, download: true })
```

**ProjectExportBlobParams**

| Param      | Type                              | Default | Description                                                                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blobId`   | `string`                          | -       | The blob to fetch                                                                                                                                                                                                                                                                                            |
| `download` | `boolean \| { filename: string }` | `false` | Also save it: the save dialog where the browser has one, a download otherwise. Under its own name the dialog opens once the blob is read; under `{ filename }` it opens first. A cancelled dialog saves nothing; a dialog refused for a lapsed gesture falls back to a download; any other failure is thrown |

**Returns** `Promise<{ entry: BlobRecord; data: Blob; filename: string }>`

Throws `BLOB_NOT_FOUND` (D7004) if the blob id is unknown.

## Undo / Redo

Undo/redo is file-scoped and managed at the Project level:

```ts
await project.undo(documentId)
await project.redo(documentId)
```

Each call updates the document's shared `DocumentEntry` deterministically — `lastUpdate` plus `canUndo`/`canRedo` recomputed from the store's history — then posts a `commit` message so other tabs converge (on a store that announces its changes, `sqlite` and `inMemory`, only when the store told a change: an undo with nothing to undo posts nothing).

## Project channel & events

Every change of the project - made by this Project, one of its Documents, or another project of it in this page, another tab or an iframe - is announced on a `BroadcastChannel`. The channel is the project's public event contract: a listener hears each change once.

```ts
project.channelName // `dialecte::project::${name}`, or one of this Project's own (see below)

const channel = project.createChannel() // fresh BroadcastChannel on channelName; caller owns it
channel.addEventListener('message', (e) => {
	const event = e.data // ProjectChannelEvent: a change (ProjectChannelMessage), or a resync
})
// ...
channel.close()
```

How the changes reach the Project depends on its store:

- **A store that announces its changes** (`sqlite`, `inMemory`; a custom store with `subscribe`): the store tells the Project every change, made by any connection of the project (each tab, iframe and Project of it). The Project folds the others' changes into its state, wakes its Documents, and reposts them on a channel of its own, `channelName` = `dialecte::project::<name>::<instance>`; it posts its own changes there once its state holds them - a change no call of the Project made (a write on the store you hold, e.g. a custom `storage`, or a Document of an earlier open) folded into its state and posted once no call of the Project runs (with the running call's own otherwise, or once that call ends; past 256 kept, at once). Every change told while the Project opens - its own (a store's cleanup) and another connection's, from the store or the name's channel - is folded and posted, in the order told, once its documents are read (past 256 of them, or a resync told meanwhile: its state read again instead). A fold no call awaits that fails - a `doc.subscribe` callback throwing as another change is folded in, or the store refusing a read - is reported with `console.error` (not a read refused `STORE_CONNECTION_LOST`: the resync that follows reads it again) and the next changes are folded all the same; a callback throwing in a Document's own transaction rejects that transaction, as before. A call that changed nothing (an undo with nothing to undo, an unknown document removed) is told to no one. Two dialectes' projects of one name never hear each other. When the store's connection is made again, to what serves the project anew (on SQLite, another engine of the project: its host gone; an idle Project's store follows it at once), or more changes are told while the Project opens than it holds, the Project reads its documents and history again, wakes every Document (`doc.subscribe`) and posts `{ type: 'resync', timestamp }` (`ProjectChannelResync`) on its channel: what changed meanwhile is in its state, not told change by change. The channel carries `ProjectChannelEvent` = `ProjectChannelMessage | ProjectChannelResync`. A Document subscriber that throws stops no other: each is told, and the first failure fails the call that changed the document, or is reported when no call awaits the change. A change may be told in its steps: a new document as `init-empty-document`, then `commit` for its first records.
- **A store that does not** (`local`, a custom store without `subscribe`): every Project of the name posts its own changes and listens on the name's channel, `dialecte::project::<name>`: a call is announced as made, a no-op included, and a write made through a store alone is told to no one.

Build no channel name by hand: open the channel through `project.createChannel()` or `doc.channelName`.

**ProjectChannelMessage**

Discriminated union; every payload carries a `timestamp`. Changing a member is a breaking API change.

```ts
type ProjectChannelMessage =
	| { type: 'commit'; documentId: string; timestamp: number }
	| { type: 'init-empty-document'; documentId: string; timestamp: number }
	| { type: 'document-removed'; documentId: string; timestamp: number }
	| { type: 'document-imported'; documentId: string; timestamp: number }
	// a document's registry entry changed (its name, its path, its metadata): read it again
	| { type: 'document-updated'; documentId: string; timestamp: number }
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

**ProjectChannelResync**, **ProjectChannelEvent**

A Project on a store that announces its changes also posts a resync once it has read its documents again (its store reached another engine; more changes told while it opened than it holds): read again what you show.

```ts
type ProjectChannelResync = { type: 'resync'; timestamp: number }
type ProjectChannelEvent = ProjectChannelMessage | ProjectChannelResync
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
await project.close() // wait for the imports and writes in flight and the channel's work, close the store and BroadcastChannel, empty the state
await project.destroy() // the same, then delete the database entirely
```

`open`, `close` and `destroy` run one at a time, in the order called: a call waits for the one before it to settle. `open` on a Project already open - on another project or on the same one - first closes it as `close()` does, and a call made from the `open` call on is refused until the last `open`, `close` or `destroy` called has settled (`open(a)` twice without waiting: the first caller's calls are refused until the second has settled). A batch `import` and a Document belong to the open they were made in: a file whose turn comes after that open closed is a failed entry (`PROJECT_NOT_OPENED`), and a Document's commits tell no later open. The Documents of the previous open answer `STORE_CLOSED` when the store is made for each open (`local`, `inMemory`, a registered kind such as `sqlite`); a `custom` store is the same one opened again - open the Documents again after `open`. A close waits for the imports in flight (running and queued), the project's writes running (a Document's transaction or prepared commit included) and the work other realms' messages started, then closes the store and the channel, empties `state.documents` and drops the Documents' subscriptions.

Once `close()` or `destroy()` is called the project is closed: `import`, `importFile`, `openDocument`, `export`, the registry reads and the blob methods throw `PROJECT_NOT_OPENED`; an import that was in flight still lands.

An `open` whose store refuses, or whose documents cannot be read, leaves the Project closed. `queryFirst` and `queryAll` answer `PROJECT_NOT_OPENED` when the project closes, or another opens, while they run - never a partial answer.

Never await `open`, `close` or `destroy` inside a hook or a transaction callback: the close waits for that work, which waits for the close - after 10 seconds the console says what the close still waits for, naming the files of the imports in flight. A close also waits for an import whose dialecte hook never settles: nothing aborts it, so an import hook must settle ([IO hooks](/io/hooks#afterimport)).

An `open` its store refused is reset as follows. When it answers that the project's data cannot be read back (SQLite storage: `PROJECT_DATABASE_LOST`, declared by `SQLITE_ERRORS` from `@dialecte/core/sqlite`), offer the user a reset - never do it on your own: `destroy()` on that same Project removes the project the refused store holds, without opening it, and `open` then makes it again, empty.

```ts
import { SQLITE_ERRORS } from '@dialecte/core/sqlite'

const project = new Project(params)
try {
	await project.open(name)
} catch (thrown) {
	if (toDialecteError(thrown)?.key !== SQLITE_ERRORS.PROJECT_DATABASE_LOST.key) throw thrown
	if (await askUserToReset()) {
		await project.destroy()
		await project.open(name)
	}
}
```

A store shared by several connections remembers the id each project was created with. A view that comes back to a project - its page back from a freeze or the back/forward cache, what serves its store started again (on SQLite, its engine after a crash) - while another tab destroyed it meanwhile is refused `PROJECT_DESTROYED_WHILE_AWAY` on every call: nothing is made empty in its place, and a project made again since under the name is not read. Tell the user, close the project in that view, and open it again by its name for what is there now.

A project's name and its dialecte's id name what holds it on every store (a store may name its files after both: a SQLite project's sit in a directory of the origin's private files): a name or an id that is empty, `.` or `..` is refused `PROJECT_NAME_INVALID` before any store of it is built, nothing opened or written.

`destroy()` is refused with `PROJECT_OPEN_ELSEWHERE` (`meta.project`, and `meta.connections` where the store counts them), nothing removed, while another project or store of the project has it open - in this page, or in another tab: close that one (await its `close()`), then call `destroy()` again. The refused one closed the project all the same, as `close()` does. One closed counts open no more, and a destroy lets the operations it still runs complete first (a store of another tab counts until they end); one destroyed counts open no more either, until it is used again. Two connections destroying at once are both refused - but two tabs destroying a local store at once may both go ahead. A connection made while another connection's destroy runs either counts - the destroy refused, its data kept - or waits for the destroy and reads the project empty; it never fails, and never reads the old data after a destroy that resolved.

## A lost connection

A store whose project is served elsewhere - in a worker, another realm, a server - can lose its connection to what serves it while a call waits. Such a call is refused `STORE_CONNECTION_LOST` (D1018); `meta.reason` is the store's own word for why (SQLite storage: [its reasons](#sqlite-storage)), and a write is never made again on its own. A Document's commit and a Project's import ask what became of them, once, by their id (`store.getWriteOutcome`): a commit that landed resolves as committed; otherwise the refusal carries `meta.outcome` - `not-applied` (make it again if the user wants), `running` (what serves the store may still apply it: its change reaches the project when it lands), `unknown` (the outcome could not be asked), or, for an import, `applied` with `meta.documentId` (the document is in the project and broadcast; its diagnostics went with the lost answer, so `import()` gives it as a `failed` entry; no `documentId` when the documents could not be read again either: `getDocuments()` later). The outcome is asked once, and not again: on `unknown` (or `running`), read the document again - the store is the truth (`project.getDocuments()`, the document's records) - and decide from what it holds whether to make the write again. A commit that may have landed (`running`, `unknown`) reads its document's history again; a prepared commit refused `not-applied` can be committed again, one whose outcome is not known cannot. An undo, a redo or a removal refused so reads the project's documents and history again before the refusal is thrown. Whatever the store told of the lost write before its connection went is broadcast.

Tell it by its key: `toDialecteError(thrown)?.key === 'STORE_CONNECTION_LOST'`.

## SQLite Storage

`{ type: 'sqlite' }` keeps a project in SQLite on the origin's private file system. One engine serves the project to every tab, window and iframe of the app: it runs in a worker started by one view - elected by the origin's hub when the page has one (`connectHub`), else the page itself - and every other view reaches it through a port. `local` stays IndexedDB and the default.

SQLite storage is opt-in: the app imports `@dialecte/core/sqlite`, and calls `registerSqliteEngine` from it once, in its entry, before it opens a project on it. The import declares the `sqlite` type (`{ type: 'sqlite' }` is a type error without it) and registers its kind ([Storage kinds](#storage-kinds)) for every copy of `@dialecte/core` of the same storage version in the page (the first import kept: one copy runs the page's engines - in a dev server too, where a hot reload of that entry keeps the registration made first until the page reloads), and gives what only SQLite storage uses: the app's engine (`registerSqliteEngine`, `serveSqliteEngine`), the hub (`connectHub`, `adoptHubPort`), `listProjects` and its errors (`SQLITE_ERRORS`, [SQLite errors](#sqlite-errors)). An app that never imports it never emits nor downloads the SQLite engine's side, its wasm file or the hub's worker; a project opened (or destroyed by name) on `sqlite` there is refused `PROJECT_STORAGE_NOT_REGISTERED`.

```ts
import engineUrl from './engine.worker?worker&url'

import { registerSqliteEngine } from '@dialecte/core/sqlite'
import { createSclProject, SCL_DIALECTE } from '@dialecte/scl'

registerSqliteEngine({ url: engineUrl, dialectes: [SCL_DIALECTE] })

const project = await createSclProject({ storage: { type: 'sqlite' } }).open('my-project')
```

- The worker file is the app's own, one for all its dialectes: see [The engine worker and its packaging](/api/dialecte#the-engine-worker-and-its-packaging). A project whose dialecte the registration does not name, or any project with no registration, is refused `PROJECT_SQLITE_ENGINE_NOT_REGISTERED`, at `open` and at `destroyProject`, nothing started.
- Open it from a dialecte's project factory: the factory knows the dialecte's id and version. A `Project` made by no factory is refused `PROJECT_ENGINE_NOT_DECLARED` at `open`.
- A project opened on `sqlite` offers every engine the app registered to the page's hub as it opens; a page that never calls `connectHub` still works. A project the page runs itself (no hub: no SharedWorker, or a hub that never welcomed the page) is joined there by the page's later projects of the name.
- Where the browser gives the view no worker or no private file system (Node, a private Firefox window, a sandboxed or storage-blocked frame), `open` is refused `STORE_UNAVAILABLE`, nothing started - but a child its page bound through `adoptHubPort` (adopt the port before the first `open`) opens its projects through the page's engine. So does a bound child that can store and registered no engine for the dialecte: a view of another origin is a client of the engines its shell starts and never registers. A view that cannot store offers the hub no engine. Such a bound child's destroys - `project.destroy()`, `destroyProject` - are deleted by a view of the origin that runs an engine of the dialecte - at its version when one does (its page first): refused `PROJECT_OPEN_ELSEWHERE` while another view uses the project, as any destroy, `STORE_UNAVAILABLE` when no view runs such an engine, and `STORE_CONNECTION_LOST` when the view deleting it goes away before it is done (its files may be partly deleted).
- The wasm file is fetched by the engine when it first opens a project, never by the page.

**When the engine is lost.** A call whose engine is lost is refused `STORE_CONNECTION_LOST` ([A lost connection](#a-lost-connection): what a commit and an import then do), its `meta.reason` one of (`ConnectionLostReason` from `@dialecte/core/sqlite`):

| `meta.reason`   | What happened                                                                                     | What the app does                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `host-gone`     | The view hosting the project's engine ended, or the engine gave no answer within its budget.      | Nothing more: a read is made once more on the next engine; a write's outcome was asked once.                         |
| `no-heartbeat`  | The engine sent nothing for too long while the call waited (busy, paused, frozen): it may finish. | Read again later: a write refused `running` may still land.                                                          |
| `realm-dropped` | The hub dropped this view with the page that bound it (frozen, gone, or unbinding it).            | Every call, the outcome's ask too, is refused until the page binds the view again (`createHubPort`, `adoptHubPort`). |

**Listing and deleting projects.** `listProjects({ dialecteId? })` lists the projects on SQLite storage of the origin - every dialecte's, or one's - read from the private file system alone (no engine started, no wasm loaded; a project open in a view is read too), sorted by dialecte and name:

```ts
import { listProjects } from '@dialecte/core/sqlite'

const projects = await listProjects({ dialecteId: createSclProject.dialecte.id })
// [{ name, dialecteId, state, bytes, lastModified }]
```

| `state`    | What it means                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `current`  | Stored by this version: open it.                                                                                                |
| `outdated` | Stored by another version of the library (`open` refuses it `PROJECT_LAYOUT_OUTDATED`): delete it, then import its files again. |
| `lost`     | Its files hold data but its database is gone (`open` refuses it `PROJECT_DATABASE_LOST`): delete it.                            |
| `new`      | Made, never written.                                                                                                            |
| `unknown`  | Its files could not be read now (its engine writing): list again.                                                               |

`createSclProject.destroyProject({ name, storage: { type: 'sqlite' } })` deletes the dialecte's project of that name without opening it - an `outdated` or `lost` one too. It is refused `PROJECT_OPEN_ELSEWHERE` while a view has it open, `PROJECT_ENGINE_BUSY` while an engine still holds its files, `PROJECT_DESTROY_FAILED` when its files could not all be removed, `PROJECT_NAME_INVALID` for a name no project can have. Where the browser gives the view no private file system both are refused `STORE_UNAVAILABLE` (each reads or deletes the files from the view itself) - but a child bound through `adoptHubPort` has its `destroyProject` deleted by a view of the origin that can store. A project open in a view is listed all the same (its files read beside its engine: checked in Chromium).

**Imports across views.** One engine runs one import at a time for every view of the project, in the order asked; an import is aborted (nothing of its file kept) when the view that asked for it goes away, and so is an export it was running.

**Storage space.** Before an import, the engine checks the origin has room for eight times the file's size (at least 1 MiB), less the project's free pages; a new project checks room for its files. Short of it, the call is refused `STORE_QUOTA_EXCEEDED`, nothing written, with `meta.needed` and `meta.available` in bytes; a write the file system refuses for want of space part way is refused so too, with `meta.available` only. A browser that gives no estimate is trusted. Core never asks the browser to keep the origin's data (`navigator.storage.persist()`): an app that must not lose its projects to eviction asks for it itself.

**Budgets.** Through the hub, an engine that has no client left closes after 5 s (an open meanwhile keeps it); a page running its engine itself (no hub) closes it when its last connection closes. An open is answered within 30 s (else `PROJECT_ENGINE_UNAVAILABLE`); a working engine tells it is alive every second, and a call that hears nothing for 10 s is refused `STORE_CONNECTION_LOST` (`no-heartbeat`).

**Browsers.** The engine needs a worker with synchronous access to the origin's private file system: current Chromium and Firefox (a private Firefox window gives none: `STORE_UNAVAILABLE`). Firefox is checked by hand, not in CI; Safari is not checked.

**How fast.** Measured on the engine's SQL in a worker on the origin's private file system (Chromium, Apple M3 Pro, October 2026), not yet end to end in an app: a 50 MB SCL project (486,333 records) imports in 7.9 s, where IndexedDB took 142 s in an app; a 500 MB one (4.2 M records) in 66.6 s, a steady 62,000-68,000 records per second up to 9.1 M records. Its file takes 1.4-1.5 GiB for 500 MB of XML. Reads of 3,000-5,000 records answer in 35-50 ms at 500 MB; deleting one voltage level (33,300 records) of a 500 MB document takes 1.3-1.4 s. A prepared database - a project's SQLite file made elsewhere and loaded as is - would land in about 1.5 s for that 500 MB file (export 550 ms, load 930 ms, open 7 ms), against about a minute to import its XML: the library does not offer that path; a project is made from XML files.

**From `local` to `sqlite`.** Nothing moves a project between stores: export each document from the `local` project and import it into a project opened on `sqlite`.

## Store errors

What every store answers, what happened and what to do (a read-only in-memory store's `STORE_NOT_WRITABLE`: [In-Memory Storage](#in-memory-storage); `STORE_BLOB_NOT_FOUND`: [Blobs](#blobs)). Every key is a `DialecteError` (`toDialecteError(thrown)?.key`); `dialecte explain <code>` prints the same. These are declared by core's catalogue (`@dialecte/core`); what only SQLite storage answers is in [SQLite errors](#sqlite-errors).

| Key (code)                                                                                                                        | What happened                                                                                                                                       | What to do                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORE_CONNECTION_FAILED` (D1001)                                                                                                 | The store could not open the project's data, or could not reach what serves it (on SQLite: its worker, or the origin's hub).                        | Check the browser supports what the store needs; reload. A child view is bound again by its page.                                               |
| `STORE_CLOSED` (D1010)                                                                                                            | A call reached a store after its `close()` (code holding a store, a Document of an earlier open).                                                   | Await every call before closing; open again before using it.                                                                                    |
| `STORE_COMMIT_FAILED` (D1002), `STORE_BULK_ADD_FAILED` (D1004), `STORE_BULK_UPDATE_FAILED` (D1005), `STORE_DELETE_FAILED` (D1006) | The database refused a write (the failure is the `cause`): a full disk or a closed store, usually.                                                  | Read `cause`; try the write again once the store is back.                                                                                       |
| `STORE_READ_FAILED` (D1011)                                                                                                       | The store's database failed under a read (the failure is the `cause`).                                                                              | Open the project again; a lasting failure means its data is damaged: import its documents again.                                                |
| `STORE_RECORD_NOT_FOUND` (D1003)                                                                                                  | A write updated a record the document does not hold.                                                                                                | Read the record again before writing: it was deleted, or the ref names another document.                                                        |
| `STORE_DUPLICATE_ID` (D1009)                                                                                                      | A write would create a record (or register a document) with an id the store holds; `meta.recordIds`.                                                | Let core mint the ids (omit `id`); `deepClone` mints new ones itself.                                                                           |
| `STORE_VALUE_NOT_JSON` (D1015)                                                                                                    | A write held a value that is not plain JSON; nothing was written.                                                                                   | Pass plain JSON values; `detail` names the field ([values a store keeps](/io/#values-a-store-keeps)).                                           |
| `STORE_UNAVAILABLE` (D1016)                                                                                                       | The view has none of the storage the store needs (on SQLite: no private file system, or no worker with synchronous file access).                    | Open the app in a normal window; a child frame is bound by its page (`adoptHubPort`).                                                           |
| `STORE_QUOTA_EXCEEDED` (D1017)                                                                                                    | Too little storage left for a new project or an import; nothing applied.                                                                            | Free space (delete projects no longer needed) or import a smaller file; `meta.needed` / `meta.available`.                                       |
| `STORE_CONNECTION_LOST` (D1018)                                                                                                   | The store lost its connection to what serves the project while the call waited: `meta.reason` the store's own; a write's `meta.outcome` asked once. | Never make a write again blindly: on `unknown` (or `running`) read the document again and decide ([A lost connection](#a-lost-connection)).     |
| `STORE_KIND_TAKEN` (D1021)                                                                                                        | `registerStorageKind` named a type a kind of another `id` holds already; the first kept. `meta`: `type`, `registered`, `asked`.                     | Register each type once, from one package ([Storage kinds](#storage-kinds)).                                                                    |
| `PROJECT_DIALECTE_MISMATCH` (D7008)                                                                                               | The project, or what serves its store, is of another dialecte than the one asked.                                                                   | Open it with its own dialecte; serve every dialecte the app opens (on SQLite: `serveSqliteEngine` gets every one `registerSqliteEngine` names). |
| `PROJECT_DIALECTE_VERSION_MISMATCH` (D7009)                                                                                       | What serves the project's store runs another version of the dialecte than this view.                                                                | Reload every tab of the app.                                                                                                                    |
| `PROJECT_DESTROY_FAILED` (D7010)                                                                                                  | A destroy left data in place: another tab, window or connection holds it.                                                                           | Close the project elsewhere, then destroy again.                                                                                                |
| `PROJECT_OPEN_ELSEWHERE` (D7011)                                                                                                  | Another tab has the project open with no shared connection to this one (an open), or another connection has it open (a destroy).                    | Close it there (await its `close()`), then open or destroy it here again.                                                                       |
| `PROJECT_DESTROYED_WHILE_AWAY` (D7013)                                                                                            | The view came back to a project another tab destroyed meanwhile.                                                                                    | Tell the user; `close()` it here, then open it again by name.                                                                                   |
| `PROJECT_NAME_INVALID` (D7014)                                                                                                    | The project's name or its dialecte's id is empty, `.` or `..`.                                                                                      | Give it another name.                                                                                                                           |
| `PROJECT_STORAGE_NOT_REGISTERED` (D7018)                                                                                          | A project (or a test store) on a `storage.type` no kind is registered for in this realm; nothing opened.                                            | Import the entry that registers it (a test's setup file too); align the core versions of a package bringing its own copy.                       |

## SQLite errors

What only SQLite storage answers: declared by `SQLITE_ERRORS`, from `@dialecte/core/sqlite`, not by core's catalogue. Their keys and codes are the ones they always had; narrow a key with `isKnownDialecteError(error, { catalogues: [SQLITE_ERRORS] })`. An error crossing from a worker or the hub is rebuilt as data, whichever entry declared it.

```ts
import { isKnownDialecteError, toDialecteError } from '@dialecte/core'
import { SQLITE_ERRORS } from '@dialecte/core/sqlite'

const error = toDialecteError(thrown)
if (error && isKnownDialecteError(error, { catalogues: [SQLITE_ERRORS] })) {
	if (error.key === 'PROJECT_DATABASE_LOST') offerReset()
}
```

| Key (code)                                     | What happened                                                                                                                                                                                                                                                                                                                      | What to do                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORE_PROTOCOL_MISMATCH` (D1012)              | Another build of the library holds the hub, or the engine speaks another wire.                                                                                                                                                                                                                                                     | Reload every tab of the app on the same version.                                                                                                                                                         |
| `STORE_REALM_ID_TAKEN` (D1013)                 | A view joined the hub with an id another view uses.                                                                                                                                                                                                                                                                                | Reload that view.                                                                                                                                                                                        |
| `STORE_REALM_UNKNOWN` (D1014)                  | A view spoke to the hub without having joined it, or after it left.                                                                                                                                                                                                                                                                | Reload the view; a child is bound again by its page.                                                                                                                                                     |
| `STORE_HUB_SPAWNERS_FIXED` (D1019)             | One registration names two versions of a dialecte, or the page runs another version of that dialecte's engine already.                                                                                                                                                                                                             | Ship one version of each dialecte in the app.                                                                                                                                                            |
| `STORE_SQLITE_ENGINE_FIXED` (D1020)            | A second `registerSqliteEngine` named another URL or other dialectes; the first kept. `meta`: `registered`, `asked`.                                                                                                                                                                                                               | Name all the app's dialectes in one call, once.                                                                                                                                                          |
| `PROJECT_LAYOUT_OUTDATED` (D7005)              | The project was stored by another version of the library; nothing written, and it cannot be opened (nor exported) by this one.                                                                                                                                                                                                     | Delete it (`destroyProject({ name, storage: { type: 'sqlite' } })`) and import its XML files again: keep the files, or export the projects before upgrading the library.                                 |
| `PROJECT_ENGINE_UNAVAILABLE` (D7006)           | The engine could not be started or reached: its worker failed to load or could not load the engine's chunk (a build or a precache list that leaves it out), no view offers its dialecte's engine, or the open budget passed; a destroy still running past the open budget, or asked by a page suspended before the hub granted it. | Check the `url` given to `registerSqliteEngine` loads (the console names the failing script); keep one tab of the app open and reload. Ask a refused destroy again once the project is closed elsewhere. |
| `PROJECT_ENGINE_BUSY` (D7007)                  | Another engine still holds the project's files.                                                                                                                                                                                                                                                                                    | Close the other tabs, then open again.                                                                                                                                                                   |
| `PROJECT_DATABASE_LOST` (D7012)                | The project's files hold data but no readable database.                                                                                                                                                                                                                                                                            | Offer the user a reset, never on your own: `destroy()` on the refused Project, then `open` ([Lifecycle](#lifecycle)).                                                                                    |
| `PROJECT_ENGINE_NOT_DECLARED` (D7015)          | A project on `sqlite` made by no dialecte's factory: no engine is known.                                                                                                                                                                                                                                                           | Make it with the dialecte's project factory.                                                                                                                                                             |
| `PROJECT_SQLITE_ENGINE_NOT_REGISTERED` (D7017) | A project on `sqlite` in a realm that can store, with no `registerSqliteEngine` call, or one that does not name its dialecte; nothing started.                                                                                                                                                                                     | Write the app's worker file and call `registerSqliteEngine({ url, dialectes })` once, naming every dialecte of the app.                                                                                  |

## In-Memory Storage

Use `{ type: 'inMemory' }` for tests, demos, or UI placeholder documents that need a valid `Document` instance without IndexedDB.

An in-memory project behaves as a SQLite one, held in memory: every project of a dialecte opened under a name in the same page (realm) reads and writes one state (two dialectes' projects of one name are two projects), so a project closed and opened again under its name finds its documents. `close()` keeps that state; `destroy()` frees it. A store closed by `close()` refuses every operation started after it with `STORE_CLOSED` until it is opened again, in memory as on IndexedDB; one already running completes. A project that is never destroyed keeps its memory until the page goes.

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

A non-writable in-memory store is useful as a **null-object placeholder** in UI frameworks: reads return empty results, writes throw loudly. This prevents silent failures when code accidentally mutates before a real document is loaded. A placeholder never reads, keeps or frees the state of its name: it reads empty even under the name of a project holding data, and its `destroy()` leaves that data.

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

`getDatabaseInstance()` answers the store's own database object, for debugging: the `Dexie` instance on `local` (typed `unknown` - cast it), `null` on `inMemory` and on `sqlite` (the engine owns the database, in its worker), and whatever a `custom` store's `getDatabaseInstance()` answers.

```ts
// storage: { type: 'local' }
const db = project.getDatabaseInstance() as Dexie
```
