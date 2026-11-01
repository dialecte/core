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

| Param              | Type                                                     | Description                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configs`          | `Record<string, AnyDialecteConfig>`                      | Config registry keyed by label                                                                                                                                                   |
| `defaultConfigKey` | `string`                                                 | Used when `configKey` is omitted. Defaults to first key.                                                                                                                         |
| `storage`          | `StorageParam`                                           | `{ type: 'local' }`, `{ type: 'sqlite' }` (a dialecte's factory only, after `import '@dialecte/core/sqlite'`), `{ type: 'inMemory', writable? }`, or `{ type: 'custom', store }` |
| `extensions`       | `{ base?: ExtensionModules; custom?: ExtensionModules }` | Base and custom extension modules merged internally via `mergeExtensions`                                                                                                        |
| `hooks`            | `DialecteHooks`                                          | All lifecycle hooks (IO + record) applied to every Document — see [Hooks](/api/hooks)                                                                                            |
| `dialecteId`       | `string`                                                 | The project's dialecte (a dialecte's project factory gives it): with the name, which project a store holds; read as `project.dialecteId`                                         |

**`project.open(name: string): Promise<this>`**

Connects the store, hydrates existing file registrations into `project.state.documents` (including each document's `canUndo`/`canRedo` from persisted history), and returns `this` for chaining. Accessing `project.name`, `project.store`, or `project.channelName` before calling `open` throws `PROJECT_NOT_OPENED` (D7003).

::: tip Dialecte packages
A dialecte package exposes a factory function (`createSclProject` in `@dialecte/scl`) that pre-configures the `Project` constructor. The way to build one is `createProjectFactory` from the dialecte's declaration: every config, the default key, the extensions and a fresh hooks instance per project come from there, and consumer code chooses its storage and its own extensions, then calls `.open(name)`. See [Dialecte declaration](/api/dialecte).
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
	if (entry.status === 'failed')
		notifyFailed(entry.fileName, entry.error) // key, message, meta
	else if (entry.diagnostics.length) notifyDiagnostics(entry.fileName, entry.diagnostics)
}
const last = entries.findLast((entry) => entry.status === 'imported')
if (last) setActiveDocument(last.documentId)
```

**ImportFilesOptions** (`importFile` takes `ImportDocumentOptions`: these and `path`)

| Param                 | Type                                 | Default            | Description                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configKey`           | `string`                             | `defaultConfigKey` | Key into the configs registry                                                                                                                                                                                                                 |
| `metadata`            | `Record<string, unknown>`            | -                  | Per-file metadata, JSON values only ([values a store keeps](/io/#values-a-store-keeps))                                                                                                                                                       |
| `chunkOptions`        | `Partial<ChunkOptions>`              | -                  | Override chunking defaults for SAX streaming                                                                                                                                                                                                  |
| `useCustomRecordsIds` | `boolean`                            | `false`            | Use IDs from XML attributes instead of generating UUIDs                                                                                                                                                                                       |
| `onProgress`          | `(progress: ImportProgress) => void` | -                  | Told after each stored batch: `{ phase, bytesRead, totalBytes }` of the file in progress - `phase` is `'storing'`, or `'indexing'` while the store builds an index of the document (edits wait meanwhile); never awaited, its failure ignored |
| `signal`              | `AbortSignal`                        | -                  | Aborts the import at the next batch: nothing of the file remains, `IMPORT_ABORTED`                                                                                                                                                            |

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

**A document is whole or absent.** Files are imported one after the other, in the order given; each lands in `project.state` and is broadcast as soon as it is in. The import itself runs in the store, next to the data (`Store.importFile`, see [Import inside the store](/io/#import-inside-the-store)): the file is registered with `status: 'importing'` before its first record is stored and set to `'ready'` once the last one is. Whatever fails in between - a malformed file (`PARSE_ERROR`, its `detail` naming what the parser saw and `meta.reason` saying `'malformed-xml'` or `'second-root'`), an import hook that throws, a store write that fails, an abort - removes the document again: `importFile` throws it, `import` makes it the file's `failed` entry and goes on with the next file. Nothing is broadcast for a failed file. One exception: an import whose engine was lost after it landed is in the project all the same and broadcast, though refused (see [When the engine is lost](#sqlite-storage)). A document still `importing` is never opened, listed or hydrated, here or in another tab. An import never outlives the store that runs it: a document a closed tab left `importing` is removed when the store next opens. With `dev.perf` on, the timings of the import's stages land on `project.perf` under `store::import::*` ([Dev perf](/guide/development/dev-perf#import-stages)).

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

- the **document registry**, synced over the project [`BroadcastChannel`](#project-channel-events) (`document-imported` / `document-removed`);
- the **active-document id**, synced by the host application out of band (e.g. a `storage` event).

Because they are not ordered, the active-document id can reach the other realm _before_ the import broadcast registered the document (`openDocument` throws `DOCUMENT_NOT_REGISTERED`); and even once the registry catches up, that realm's connection may predate the schema that added the document's partition, so a read answers empty (a document a connection does not know reads as absent: no records, a count of 0).

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

Each call updates the document's shared `DocumentEntry` deterministically — `lastUpdate` plus `canUndo`/`canRedo` recomputed from the store's history — then broadcasts a `commit` message so other tabs converge.

## Project channel & events

Every change of the project - made by this Project, one of its Documents, or another project of it in this page, another tab or an iframe - is announced on a `BroadcastChannel`. The channel is the project's public event contract: a listener hears each change once.

```ts
project.channelName // `dialecte::project::${name}`, or one of this Project's own (see below)

const channel = project.createChannel() // fresh BroadcastChannel on channelName; caller owns it
channel.addEventListener('message', (e) => {
	const message = e.data // ProjectChannelMessage
})
// ...
channel.close()
```

How the changes reach the Project depends on its store:

- **A store that announces its changes** (`sqlite`, `inMemory`; a custom store with `subscribe`): the store tells the Project every change, made by any connection of the project (each tab, iframe and Project of it). The Project folds the others' changes into its state, wakes its Documents, and reposts them on a channel of its own, `channelName` = `dialecte::project::<name>::<instance>`; it posts its own changes there once its state holds them - a change no call of the Project made (a write on the store you hold, e.g. a custom `storage`, or a Document of an earlier open) folded into its state and posted once no call of the Project runs and its open settled (with the running call's own otherwise, or once that call ends; past 256 kept, at once). A fold no call awaits that fails - a `doc.subscribe` callback throwing as another change is folded in, or the store refusing a read - is reported with `console.error` and the next changes are folded all the same; a callback throwing in a Document's own transaction rejects that transaction, as before. A call that changed nothing (an undo with nothing to undo, an unknown document removed) is told to no one. Two dialectes' projects of one name never hear each other. When the store reaches another engine of the project (its host gone), the Project reads its documents and history again and wakes every Document (`doc.subscribe`); nothing is posted on the channel for it. A change may be told in its steps: a new document as `init-empty-document`, then `commit` for its first records.
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

`open`, `close` and `destroy` run one at a time, in the order called: a call waits for the one before it to settle. `open` on a Project already open - on another project or on the same one - first closes it as `close()` does, and a call made from the `open` call on is refused until the last `open`, `close` or `destroy` called has settled (`open(a)` twice without waiting: the first caller's calls are refused until the second has settled). A batch `import` and a Document belong to the open they were made in: a file whose turn comes after that open closed is a failed entry (`PROJECT_NOT_OPENED`), and a Document's commits tell no later open. The Documents of the previous open answer `STORE_CLOSED` when the store is made for each open (`local`, `inMemory`); a `custom` store is the same one opened again - open the Documents again after `open`. A close waits for the imports in flight (running and queued), the project's writes running (a Document's transaction or prepared commit included) and the work other realms' messages started, then closes the store and the channel, empties `state.documents` and drops the Documents' subscriptions.

Once `close()` or `destroy()` is called the project is closed: `import`, `importFile`, `openDocument`, `export`, the registry reads and the blob methods throw `PROJECT_NOT_OPENED`; an import that was in flight still lands.

An `open` whose store refuses, or whose documents cannot be read, leaves the Project closed. `queryFirst` and `queryAll` answer `PROJECT_NOT_OPENED` when the project closes, or another opens, while they run - never a partial answer.

Never await `open`, `close` or `destroy` inside a hook or a transaction callback: the close waits for that work, which waits for the close - after 10 seconds the console says what the close still waits for, naming the files of the imports in flight. A close also waits for an import whose dialecte hook never settles: nothing aborts it, so an import hook must settle ([IO hooks](/io/hooks#afterimport)).

An `open` its store refused is reset as follows. When it answers `PROJECT_DATABASE_LOST` (the project's data cannot be read back), offer the user a reset - never do it on your own: `destroy()` on that same Project removes the project the refused store holds, without opening it, and `open` then makes it again, empty.

```ts
const project = new Project(params)
try {
	await project.open(name)
} catch (thrown) {
	if (toDialecteError(thrown)?.key !== 'PROJECT_DATABASE_LOST') throw thrown
	if (await askUserToReset()) {
		await project.destroy()
		await project.open(name)
	}
}
```

A project file remembers the id it was created with. A view of a SQLite project that comes back to it - its page back from a freeze or the back/forward cache, its engine started again after a crash - while another tab destroyed it meanwhile is refused `PROJECT_DESTROYED_WHILE_AWAY` on every call: nothing is made empty in its place, and a project made again since under the name is not read. Tell the user, close the project in that view, and open it again by its name for what is there now.

A project's name and its dialecte's id name what holds it on every store (a SQLite project's files sit in a directory of the origin's private files named after both): a name or an id that is empty, `.` or `..` is refused `PROJECT_NAME_INVALID` before any store of it is built, nothing opened or written.

`destroy()` is refused with `PROJECT_OPEN_ELSEWHERE` (`meta.project`, and `meta.connections` where the store counts them), nothing removed, while another project or store of the project has it open - in this page, or in another tab: close that one (await its `close()`), then call `destroy()` again. The refused one closed the project all the same, as `close()` does. One closed counts open no more, and a destroy lets the operations it still runs complete first (a store of another tab counts until they end); one destroyed counts open no more either, until it is used again. Two connections destroying at once are both refused - but two tabs destroying a local store at once may both go ahead. A connection made while another connection's destroy runs either counts - the destroy refused, its data kept - or waits for the destroy and reads the project empty; it never fails, and never reads the old data after a destroy that resolved.

## SQLite Storage

`{ type: 'sqlite' }` keeps a project in SQLite on the origin's private file system. One engine serves the project to every tab, window and iframe of the app: it runs in a worker started by one view - elected by the origin's hub when the page has one (`connectHub`), else the page itself - and every other view reaches it through a port. `local` stays IndexedDB and the default.

SQLite storage is opt-in: the app imports `@dialecte/core/sqlite` once, in its entry, before it opens a project on it. The import registers the `sqlite` storage kind for every copy of `@dialecte/core` of the same storage version in the page (the first import kept: one copy runs the page's engines - in a dev server too, where a hot reload of that entry keeps the registration made first until the page reloads) and gives what only SQLite storage uses: the hub (`connectHub`, `adoptHubPort`) and `listProjects`. An app that never imports it never emits nor downloads the SQLite engine's side, its wasm file or the hub's worker; a project opened (or destroyed by name) on `sqlite` there is refused `PROJECT_SQLITE_NOT_IMPORTED`, the import to add named.

```ts
import '@dialecte/core/sqlite'
import { createSclProject } from '@dialecte/scl'

const project = await createSclProject({ storage: { type: 'sqlite' } }).open('my-project')
```

- Open it from a dialecte's project factory: the factory knows the dialecte's version and its engine worker. A `Project` made by no factory is refused `PROJECT_ENGINE_NOT_DECLARED` at `open`.
- A project opened on `sqlite` offers its dialecte's engine to the page's hub as it opens; a page that never calls `connectHub` still works. A project the page runs itself (no hub: no SharedWorker, or a hub that never welcomed the page) is joined there by the page's later projects of the name.
- Where the browser gives the view no worker or no private file system (Node, a private Firefox window, a sandboxed or storage-blocked frame), `open` is refused `STORE_UNAVAILABLE`, nothing started - but a child its page bound through `adoptHubPort` (adopt the port before the first `open`) opens its projects through the page's engine. A view that cannot store offers the hub no engine (`connectHub` registers none), and its destroys - `project.destroy()`, `destroyProject` - are refused `STORE_UNAVAILABLE`: a destroy deletes the files with a worker of the view's own.
- The wasm file is fetched by the engine when it first opens a project, never by the page.

**When the engine is lost.** A call whose engine is lost - its host gone (`meta.reason` `host-gone`), silent too long (`no-heartbeat`), or the view dropped by the hub with the page that bound it (`realm-dropped`: every call, the outcome's ask too, is refused until the page binds the view again) - is refused `STORE_ENGINE_LOST`; a write is never made again on its own. A Document's commit and a Project's import ask what became of them, once, by their id: a commit that landed resolves as committed; otherwise the refusal carries `meta.outcome` - `not-applied` (make it again if the user wants), `running` (a silent engine may still apply it: its change reaches the project when it lands), `unknown` (the outcome could not be asked), or, for an import, `applied` with `meta.documentId` (the document is in the project and broadcast; its diagnostics went with the lost answer, so `import()` gives it as a `failed` entry; no `documentId` when the documents could not be read again either: `getDocuments()` later). The outcome is asked once: asking again later (`running`, `unknown`) is the caller's, by `getWriteOutcome({ writeId })` with `meta.writeId`. A commit that may have landed (`running`, `unknown`) reads its document's history again; a prepared commit refused `not-applied` can be committed again, one whose outcome is not known cannot. An undo, a redo or a removal refused so reads the project's documents and history again before the refusal is thrown. Whatever the store told of the lost write before its engine went is broadcast.

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

`createSclProject.destroyProject({ name })` deletes the dialecte's project of that name without opening it - an `outdated` or `lost` one too. It is refused `PROJECT_OPEN_ELSEWHERE` while a view has it open, `PROJECT_ENGINE_BUSY` while an engine still holds its files, `PROJECT_DESTROY_FAILED` when its files could not all be removed, `PROJECT_NAME_INVALID` for a name no project can have. Where the browser gives the view no private file system both are refused `STORE_UNAVAILABLE` (each reads or deletes the files from the view itself). A project open in a view is listed all the same (its files read beside its engine: checked in Chromium).

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

`getDatabaseInstance()` exposes the native database instance. Return type is inferred from the storage choice - no cast needed for the default `local` storage:

```ts
// storage: { type: 'local' } -> return type is Dexie, inferred
const db = project.getDatabaseInstance()

// storage: { type: 'custom', store: myStore } -> return type is ReturnType<typeof myStore.getDatabaseInstance>
const db = project.getDatabaseInstance()
```
