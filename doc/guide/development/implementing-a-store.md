---
description: How to implement the Store port for a custom backend - what every store answers to, the order in which it tells changes, and what it does when its data is out of reach.
---

# Implementing a store

A `Project` reads and writes through one `Store`: core serves `local` (IndexedDB), `inMemory` and `custom` itself, and `@dialecte/core/sqlite` registers `sqlite`. Any other backend plugs in as a custom store, or, for a package that brings a backend to every app, as a storage kind of its own ([Register a storage kind](#register-a-storage-kind)):

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
- **Writes are whole, refused in a fixed order.** `commit` writes everything or nothing, refused first `DOCUMENT_NOT_REGISTERED` (not registered, or still importing), then `STORE_VALUE_NOT_JSON` for its `writeId` (missing or not well-formed text), `STORE_RECORD_NOT_FOUND` for an update of a record the document does not hold, `STORE_VALUE_NOT_JSON` for a create, `STORE_DUPLICATE_ID` for an id the document or the commit already holds, `STORE_VALUE_NOT_JSON` for an update; a delete of an absent id is ignored. `bulkWrite` is refused `DOCUMENT_NOT_REGISTERED`, then `STORE_VALUE_NOT_JSON` for a create, `STORE_DUPLICATE_ID`, `STORE_VALUE_NOT_JSON` for an update patch; an update or a delete of an absent record is ignored (never `STORE_RECORD_NOT_FOUND`).
- **Lifecycle.** `open()` after a `close()` waits for the operations still running; `close()` refuses every operation started after it with `STORE_CLOSED`, lets the running ones complete, and keeps the state; `destroy()` deletes the state of the name, refused `PROJECT_OPEN_ELSEWHERE` (nothing removed) while another connection has it open. `open({ create: false })` makes nothing: a project that is not there (never made, destroyed, its storage cleared) is refused `PROJECT_NOT_FOUND`, the store left refusing its operations `STORE_CLOSED`; a project made and still empty opens.
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

- `ImportTarget` is the store's own `registerDocument`, `getDocument`, `removeDocument` and `bulkWrite`, plus `markReady` (the one way a document becomes `ready`) and `writeSession(documentId, ops, control?)` (the import session's writes, checked as `bulkWrite` checks them; a store that writes them in batches tells `control.onProgress({ done, total })` after each, `total` being every create, update and delete it was handed - core tells `0` before and `total` after on its own, so a store writing them in one step may ignore `control`). A `close()` after the import started must not refuse it: the import is one operation and completes.
- `ExportSource` is the store's `getDocument`, `count`, `getMany`, `getByTagNameInDocument`, plus `getExportVersion` - how many writes the document has taken (`undefined` once it is not registered or not `ready`). A write during the export restarts it once; a second one fails it `EXPORT_CONFLICT`.
- A `StoreRuntime` is `{ configs, defaultConfigKey, hooks?, perf?, dialecteVersion? }` (the version only for a store that runs the dialecte elsewhere and checks it runs that one, as SQLite does): build it from the dialecte's declaration (`DIALECTE.configs`, `DIALECTE.defaultConfigKey`). A store on the page shares the project's hooks instance (hand the same one to the `Project`'s `hooks`); a store apart, in a worker, makes its own with `DIALECTE.createHooks()`.

## Looking records up by attribute (optional)

`getByAttributes({ documentId, tagName, attributes })` lets the store answer `findByAttributes` without handing over the whole tag: `attributes` is a list of `{ name, values }`, and the answer is the records of the tag holding, for every entry, an attribute of that name with one of its values - in id order, one row per record, compared as stored strings (no namespace, type or default handling: any attribute of that name counts). The query layer pushes only the attributes it can compare that way (not `xsi:type`, not a QName-typed attribute, never `''`), lays the transaction's staged writes over the answer and checks every record against the whole filter again, so an answer holding more than the filter keeps is harmless, one missing a match is a bug. A list of values is one call. A store without the member is read by tag and filtered, with the same records in the same order. `inMemory` has it (an attribute map per tag, built for each attribute name the first time it is asked and dropped at the tag's next write), and so does `sqlite`: the first lookup of a (tag, attribute) pair indexes it in the project file inside that call, in one write, then answers from the index, and SQL triggers keep it exact on every write from then on. A build costs about two lookups that scan the tag (about 0.3 s for a 90,000-record tag, 2.5 s for 500,000), once per pair per file: requests from other tabs behind the hub queue behind it, the accepted cost of never scanning that tag again. While an import runs, or when a build fails (a full file), the lookup is filtered in SQL instead, so only the matching records leave the engine; a failed pair is built by the next engine. Any other build failure is not hidden: the lookup is refused `STORE_COMMIT_FAILED`, and a build whose rollback failed too leaves the connection in its transaction, so the engine breaks and its host starts the next one, as after a stranded import. Only the pairs asked are indexed, so the file grows with what is queried, and writes cost more only for records of a tag that has a pair. `local` does not have it. The store contract's `attribute-lookup` cases run on every leg that has it; a leg without it marks the feature `pending`.

`readVersioned({ documentId, read })` answers one read (`read` is `{ member, args }`, plain data, for `get`, `getMany`, `getByTagNameInDocument`, `getByAttributes` or `getByDocumentId`) together with the document's version: `{ value, version }`, `version` being `{ engineId, count }`. Both are read in the same step, never one beside the other, so a write landing between them can never pair an older answer with a newer version. Equal versions mean an unchanged document; every write that changes what a read answers - through this connection or another, an undo, a redo, a removal, an import - gives a version never answered before, and `engineId` (another one whenever the counting starts again: a new engine, a database or a state made anew) keeps a count started over from being taken for an older one. Two counts of one `engineId` are ordered (the higher is newer); counts of two engine ids are never compared. `runVersionedRead` (`src/store/versioned-read.ts`) serves it only for a store whose read members read before their first await; never for one that awaits first (its answer could then be paired with a later version). `sqlite` has it on every link (in the page, in a worker, through the hub). A store without it keeps no version, and what reads through it keeps nothing between two reads. `inMemory` has it too; `local` does not. The store contract's `versioned-read` cases run on every leg that has it; a leg without it marks the feature `pending`.

`readVersion({ documentId })` answers the document's version alone, `{ engineId, count }`, without reading a record. Every commit, undo, redo and removal moves `count` by exactly one; a commit, an undo and a redo answer the version they produced, read in the write's own step (`commit` answers `{ version }`, an undo's or a redo's `HistoryStep` carries `version`, and a store that announces tells it on the commit message); a removal answers nothing: read it with `readVersion`. A write refused or failed never moves it. An import and a bulk write move it by any amount. A document never written answers 0; an id removed and registered again goes on from its count; a removal of an id never registered moves its count too. Every connection to one state answers one `engineId`; a state made again (a database destroyed and created, an engine started again) answers another. The id need only differ from those of the other states the same copy of core can reach: the in-memory store counts its states (`in-memory#<n>`), IndexedDB and SQLite draw random ids. Two counts of one `engineId` are ordered, counts of two never compared. A store with `readVersioned` answers the same version through both. Every built-in store has it; a custom store may leave it out, and its writes then answer no version. The store contract's `versions` cases run on every leg.

## Telling changes

A Project must hear every change of its project, made by any connection. Two ways:

- **What a write changed.** `commit({ deletes })` gives each deleted record as a ref, `{ id, tagName, parentId }` with the parent it had: delete by `id` and keep the stored record as the history image - the ref's tag and parent only tell the change. `undo` and `redo` take `{ documentId, changeId }` and answer what they applied under that id, `{ changeId, changes }` (`HistoryStep`); a `changeId` missing or not well-formed text is refused `STORE_VALUE_NOT_JSON` before anything steps. Build the changes with `describeHistoryStep({ images, direction })` over the entry's images (`creates`, the updated records `befores` and `afters`, `deletes` as stored; `direction` `back` for an undo, `forward` for a redo). With nothing to step (either end of the history), answer `false` and write and tell nothing. Past 5,000 refs the changes are `{ unknown: true }`. A commit's changes come from its arguments, a step's from the images the history keeps: a delete of an absent id is told in the commit's `deleted` and left out of its undo and redo, and a direct `store.commit` that creates and deletes the same id is told in both lists (a Project's commit never does: it merges them away first).
- **The store announces** (`subscribe`, as `sqlite` and `inMemory` do): it tells each listener every change (`{ type: 'change', message, own }`), made through this connection or another, in this page or another tab. The change a call of this connection made is told **before that call settles** - the Project relies on that order to fold its own write before its caller reads. A commit is told with `describeCommitChanges` over its arguments and its `writeId` as the message's `changeId`, an undo or a redo with the changes and the `changeId` it answered, a bulk write with `{ unknown: true }` under one id the store draws for it (the same on every connection). A call whose answer says it changed nothing (`false`: nothing to step, an unknown document, an empty bulk write) tells nothing; an undo or a redo that stepped is told, even when its change lists are empty (the step of a commit that only deleted an absent id). `{ type: 'resync' }` tells the listener changes may have been missed (the connection was made again, to what serves the store anew: another engine, another server): the Project then reads its documents and history again and posts a resync on its channel. A closed store tells nothing until opened again.
- **The store does not** (no `subscribe`, as `local`): every Project of the name posts its own changes on the name's `BroadcastChannel` and calls `reconcile(documentId)` when another realm added or removed a document (`document-imported`, `init-empty-document`, `document-removed`), as `getDocumentStatus` does. `reconcile` brings the connection in step with the persisted state (Dexie reopens with the new tables; an in-memory store does nothing); `isDocumentReadable` is the read-only probe that follows it. A write made through such a store directly, not through a Project, is told to no one.

## When the data is out of reach

A store whose data lives across a link that can break - a worker, a server - follows what the SQLite engine store does:

- **Never call a busy backend lost.** Decide "lost" from a liveness signal the backend sends while it works (the SQLite engine posts a heartbeat from inside its long statements), not from a fixed call budget: a long commit is not a dead one.
- **Refuse the calls in flight `STORE_CONNECTION_LOST`**, with `meta.reason` saying why - a word of the store's own, documented with it (the SQLite store's: `host-gone`, `no-heartbeat`, `realm-dropped`) - and, for a write, its `meta.writeId`. A read may be made again on the next link; **never make a write again**: it may have landed.
- **Answer `getWriteOutcome({ writeId })`**: `applied`, `running` (an import still under way) or `not-applied`. Every `commit` carries its caller's `writeId` (required: one missing is refused `STORE_VALUE_NOT_JSON`), every `importFile` one too (generate one when absent) and keeps it with what it wrote: the commit's history entry, the import's registry row. `writeOutcomeOf` computes the answer from the registry and the history, and `removeUnfinishedImports` cleans up at open ([Import inside the store](/io/#import-inside-the-store)). The Project asks it once after a lost write and puts the answer in the refusal's `meta.outcome` (see [A lost connection](/api/project#a-lost-connection)).
- **Tell a resync** once the link is back: what changed meanwhile was not told change by change.

## Register a storage kind

A custom store is one project's choice: the app builds the store and passes it. A package that brings a backend to every app (a server store, a store on another database) registers a **storage kind** instead: an app then opens a project on `{ type: '<its type>', ... }` like on `local`, and the package builds the store. Two steps, both in the entry the app imports to opt in (`@dialecte/core/sqlite` does the same for `sqlite`):

```ts
// @acme/postgres-store - its entry
import { registerStorageKind } from '@dialecte/core'

import type { StorageKind } from '@dialecte/core'

// 1. the type: `StorageParam` accepts it once this module is imported (a type error before)
declare module '@dialecte/core' {
	interface StorageKinds {
		postgres: { type: 'postgres'; url: string }
	}
}

// 2. the kind: how a project of that type gets its store
const POSTGRES_KIND: StorageKind<'postgres'> = {
	id: '@acme/postgres-store@1',
	storeOf({ name, storage, runtime, dialecteId }) {
		return new PostgresStore({ name, url: storage.url, runtime, dialecteId })
	},
}

registerStorageKind({ type: 'postgres', kind: POSTGRES_KIND })
```

```ts
// the app
import '@acme/postgres-store'

const project = await createSclProject({
	storage: { type: 'postgres', url: 'https://db.example' },
}).open('my-project')
await createSclProject.destroyProject({
	name: 'old-project',
	storage: { type: 'postgres', url: 'https://db.example' },
})
```

- **`storeOf({ name, storage, runtime, dialecteId?, perf? })`** builds the store of one project, as `open` and the factory's `destroyProject` ask it (a destroy is never preceded by an open): `storage` is the param the app gave, typed by the augmentation; `runtime` is what the store imports and exports with; `dialecteId` with the name says which project. It builds only: `open()` connects.
- **`testStoreOf({ name, storage, dialecte, perf? })`**, optional, is the store a test project opens on in the test's own realm (`useTestStorage({ type })`, `createTestContext`): a kind whose store runs elsewhere (a worker, a server) runs it here, as the test helpers know the dialecte, not where the app serves it. Keep in mind that the kind is in the app's bundle: a test store that pulls a heavy backend into it belongs in a test entry of its own instead (SQLite's in-process engine is `@dialecte/core/test`'s, not the `sqlite` kind's). Without it, a test project opens on the storage as it is (`storeOf`). A test opts in as an app does: its runner's setup file imports the entry.
- **The type** is declared by the module augmentation, against `@dialecte/core` (core's own `sqlite` entry augments its source module, which `dist/index.d.ts` re-exports). A consumer that never imports the entry gets a type error on `{ type: 'postgres' }`, and `PROJECT_STORAGE_NOT_REGISTERED` at run time if it gets past the compiler.
- **One registration per type.** The first registration of a type in the realm is kept. Registering the same `id` again does nothing (a module evaluated twice, another copy of the package; after a hot reload the kind first registered keeps serving until a full reload); another `id` is refused `STORE_KIND_TAKEN` (`meta`: `type`, `registered`, `asked`), nothing replaced. Core's own types (`local`, `inMemory`, `custom`) are refused: core serves them. Give `id` the package's name: copies of the package then share one kind, the first registered serving them all - keep what must match between copies (as SQLite keeps its engine registration) under a key versioned on its own, so a copy of another version is refused at open, not at import.
- **Shared by copies of one version.** The registry lives on the realm's global object under a key versioned by core's storage version (`STORAGE_KINDS_VERSION`: the `StorageKind` shape and the `Store` contract), so a dialecte package that brings its own copy of `@dialecte/core` finds the kinds the app's copy registered - when both are of the same storage version. A copy of another version sees none (`PROJECT_STORAGE_NOT_REGISTERED`): align the core versions.
- **Errors of its own.** A kind's backend-specific refusals are a catalogue of its own (`defineErrors`), as `SQLITE_ERRORS` is SQLite's; the generic ones (`STORE_CONNECTION_LOST`, `STORE_UNAVAILABLE`, `PROJECT_OPEN_ELSEWHERE` ...) are core's ([Store errors](/api/project#store-errors)).

## Checking a store

Core's store contract suite (`src/store/contract/` in the core repository) runs one table of cases over every store it ships - `InMemoryStore`, `DexieStore`, the SQLite engine store in process, in a worker and through the hub, one test file per store - so they differ only in speed. A difference is a store bug, unless the case names it as one the store cannot have (an in-memory store has no storage limit). The stores behind a port (an engine in a worker, through the hub) run the cases about what crosses the port - second connections, announcements, engines ending, imports and exports, text kept as written - and every member of the engine's wire must be called by one of them; a release runs the full table on every store (`npm run test:browser:release`: the whole suite in the browser with `STORE_CONTRACT_FULL_TABLE=1`). The suite is not exported yet: a custom store is checked by its own tests against the contract in `store.types.ts`.

## See also

- [Project](/api/project) - storage choice, channel events, the store's errors and what to do
