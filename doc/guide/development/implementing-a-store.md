---
description: How to implement the Store port for a custom backend - what every store answers to, the order in which it tells changes, and what it does when its data is out of reach.
---

# Implementing a store

A `Project` reads and writes through one `Store`: core ships `local` (IndexedDB), `inMemory` and, behind `@dialecte/core/sqlite`, `sqlite`. Any other backend plugs in as a custom store:

```ts
import { Project } from '@dialecte/core'

import type { Store } from '@dialecte/core'

const project = await new Project({
	configs: { scl: SCL_DIALECTE_CONFIG },
	storage: { type: 'custom', store: myStore },
}).open('my-project')
```

`Store` is the database port (`src/store/store.types.ts`): every method is document-scoped by `documentId`, takes and answers plain records, and knows nothing of a dialecte's types. Its doc comments are the contract; this page is the map. The project hands a `custom` store over as it is: the same instance is opened again on every `open`, and the Documents of an earlier open must be opened again (see [Project lifecycle](/api/project#lifecycle)).

## What every store answers to

- **A name is one state.** A store built again under a name finds what was written, until a store of that name is destroyed. The scope is the backend's (an IndexedDB database is the origin's, an in-memory state the page's).
- **Records are values.** Once a call returns, the caller's objects and the store are apart: changing one never changes the other.
- **Order.** List reads answer in id order (ids compared by UTF-16 code unit, as an IndexedDB key range orders them); `getMany` in the order asked; `getChangeLog` in sequence order; a parent's children in the order written.
- **JSON values only.** Records, document metadata and blob entries hold well-formed strings, finite numbers, booleans, `null`, arrays and plain objects, nested at most 512 levels. A field holding `undefined` is dropped. Anything else (a `Date`, a `Map`, `NaN`, a lone surrogate, a class instance, a cycle...) refuses the whole write with `STORE_VALUE_NOT_JSON`, nothing written. Each write's doc comment says where that check comes in its order of refusals.
- **Writes are whole, refused in a fixed order.** `commit` writes everything or nothing, refused first `DOCUMENT_NOT_REGISTERED` (not registered, or still importing), then `STORE_VALUE_NOT_JSON` for its `writeId`, `STORE_RECORD_NOT_FOUND` for an update of a record the document does not hold, `STORE_VALUE_NOT_JSON` for a create, `STORE_DUPLICATE_ID` for an id the document or the commit already holds, `STORE_VALUE_NOT_JSON` for an update; a delete of an absent id is ignored. `bulkWrite` is refused `DOCUMENT_NOT_REGISTERED`, then `STORE_VALUE_NOT_JSON` for a create, `STORE_DUPLICATE_ID`, `STORE_VALUE_NOT_JSON` for an update patch; an update or a delete of an absent record is ignored (never `STORE_RECORD_NOT_FOUND`).
- **Lifecycle.** `open()` after a `close()` waits for the operations still running; `close()` refuses every operation started after it with `STORE_CLOSED`, lets the running ones complete, and keeps the state; `destroy()` deletes the state of the name, refused `PROJECT_OPEN_ELSEWHERE` (nothing removed) while another connection has it open.
- **Unfinished imports.** A document registered `importing` stays so until its import marks it ready (`updateDocument` takes no `status`); a store that opens removes the imports a previous run left (`removeUnfinishedImports`).

## Import and export next to the data

A store runs a file's import and a document's export itself, next to its data, so a store in a worker never ships records across the boundary one by one. Core gives both runs; a custom store calls them with itself as target and the dialecte's configs and hooks as runtime:

```ts
import { runExport, runImport } from '@dialecte/core'

import type { ExportFileParams, ImportFileParams, StoreRuntime } from '@dialecte/core'

class MyStore implements Store {
	constructor(private runtime: StoreRuntime) {}

	importFile({ file, options, writeId, onProgress, signal }: ImportFileParams) {
		return runImport(
			{
				store: this.importTarget(),
				runtime: this.runtime,
				file,
				options,
				writeId: writeId ?? crypto.randomUUID(),
			},
			{ onProgress, signal },
		)
	}

	exportFile({ documentId, options, onProgress, signal }: ExportFileParams) {
		return runExport(
			{ source: this.exportSource(), runtime: this.runtime, documentId, options },
			{ onProgress, signal },
		)
	}
	// ...
}
```

- `ImportTarget` is the store's own `registerDocument`, `getDocument`, `removeDocument` and `bulkWrite`, plus `markReady` (the one way a document becomes `ready`) and `writeSession` (the import session's writes, checked as `bulkWrite` checks them). A `close()` after the import started must not refuse it: the import is one operation and completes.
- `ExportSource` is the store's `getDocument`, `count`, `getMany`, `getByTagNameInDocument`, plus `getExportVersion` - how many writes the document has taken (`undefined` once it is not registered or not `ready`). A write during the export restarts it once; a second one fails it `EXPORT_CONFLICT`.
- A `StoreRuntime` is `{ configs, defaultConfigKey, hooks?, perf?, dialecteVersion? }` (the version only for a store that reaches an engine of the dialecte, as SQLite does): build it from the dialecte's declaration (`DIALECTE.configs`, `DIALECTE.defaultConfigKey`). A store on the page shares the project's hooks instance (hand the same one to the `Project`'s `hooks`); a store apart, in a worker, makes its own with `DIALECTE.createHooks()`.

## Telling changes

A Project must hear every change of its project, made by any connection. Two ways:

- **The store announces** (`subscribe`, as `sqlite` and `inMemory` do): it tells each listener every change (`{ type: 'change', message, own }`), made through this connection or another, in this page or another tab. The change a call of this connection made is told **before that call settles** - the Project relies on that order to fold its own write before its caller reads. A call that changed nothing tells nothing. `{ type: 'resync' }` tells the listener changes may have been missed (the connection reached another engine, another server): the Project then reads its documents and history again and posts a resync on its channel. A closed store tells nothing until opened again.
- **The store does not** (no `subscribe`, as `local`): every Project of the name posts its own changes on the name's `BroadcastChannel` and calls `reconcile(documentId)` when another realm added or removed a document (`document-imported`, `init-empty-document`, `document-removed`), as `getDocumentStatus` does. `reconcile` brings the connection in step with the persisted state (Dexie reopens with the new tables; an in-memory store does nothing); `isDocumentReadable` is the read-only probe that follows it. A write made through such a store directly, not through a Project, is told to no one.

## When the data is out of reach

A store whose data lives across a link that can break - a worker, a server - follows what the SQLite engine store does:

- **Never call a busy backend lost.** Decide "lost" from a liveness signal the backend sends while it works (the SQLite engine posts a heartbeat from inside its long statements), not from a fixed call budget: a long commit is not a dead one.
- **Refuse the calls in flight `STORE_ENGINE_LOST`**, with `meta.reason` saying why (`host-gone`, `no-heartbeat`, `realm-dropped` for the SQLite store) and, for a write, its `meta.writeId`. A read may be made again on the next link; **never make a write again**: it may have landed.
- **Answer `getWriteOutcome({ writeId })`**: `applied`, `running` (an import still under way) or `not-applied`. Every `commit` and `importFile` carries a caller's `writeId` (generate one when absent) and keeps it with what it wrote: the commit's history entry, the import's registry row. `writeOutcomeOf` computes the answer from the registry and the history, and `removeUnfinishedImports` cleans up at open ([Import inside the store](/io/#import-inside-the-store)). The Project asks it once after a lost write and puts the answer in the refusal's `meta.outcome` (see [Store errors](/api/project#store-errors)).
- **Tell a resync** once the link is back: what changed meanwhile was not told change by change.

## Checking a store

Core's store contract suite (`src/store/contract/` in the core repository) runs one table of cases over every store it ships - `InMemoryStore`, `DexieStore`, the SQLite engine store in process, in a worker and through the hub - so they differ only in speed. A difference is a store bug, unless the case names it as one the store cannot have (an in-memory store has no storage limit). The suite is not exported yet: a custom store is checked by its own tests against the contract in `store.types.ts`.

## See also

- [Project](/api/project) - storage choice, channel events, the store's errors and what to do
