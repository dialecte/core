import type { Diagnostic } from '@/diagnostics'
import type { PerfSnapshot } from '@/perf'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, ChunkOptions, RecordPatch } from '@/types'

/**
 * RecordSchema — backend-agnostic index declaration for record tables.
 *
 * Each dialecte declares what fields to index. Store implementations
 * translate this into their native format (Dexie DSL, SQL DDL, Mongo indexes, etc.).
 */
export type RecordSchema = {
	/** Primary key field name */
	primaryKey: string
	/** Auto-increment primary key (e.g. Dexie ++id, SQL AUTOINCREMENT) */
	autoIncrement?: boolean
	/** Single-field indexes */
	indexes: string[]
	/** Compound indexes (multiple fields queried together) */
	compoundIndexes: string[][]
	/** Array field indexes (per-element lookup: Dexie multi-entry, Mongo multikey, SQL junction/GIN) */
	arrayIndexes: string[]
}

/**
 * Store — the database port.
 *
 * Abstracts persistence so Document/Transaction don't couple to IndexedDB.
 * Implement DexieStore for IndexedDB, or any other backend (SQLite, Mongo, InMemory).
 *
 * All record operations are document-scoped via documentId.
 * Not generic on Config — stores raw records as-is.
 * Type narrowing lives in Document/Transaction, not here.
 *
 * What every store answers to, whichever its backend (the store contract suite checks it): a name is
 * one state for every store of that name in its scope - a store built again under the name finds
 * what was written, until a store of that name is destroyed. The scope is the backend's: an IndexedDB
 * database is the origin's, an in-memory state the realm's. Records are values: once a write or a read
 * returns, the caller's objects and the store are apart - changing one never changes the other
 * (documents, records, changelog entries, blob entries; Blob data is immutable). List reads answer in
 * id order - `getDocuments`, `getByDocumentId`, `getByTagNameInDocument`, the blob lists - ids compared
 * by UTF-16 code unit, as an IndexedDB key range orders them; `getMany` answers in the order asked,
 * `getChangeLog` in sequence order.
 *
 * A store holds JSON values only, in records and in document metadata: strings, finite numbers,
 * booleans, null, and arrays and plain objects of them. A field holding `undefined` is dropped: a
 * record or a document created with one reads back without it, and an update leaves that field as it
 * was. Any other value - a Date, a Map, a Set, NaN or Infinity, a BigInt, a function, a symbol, an
 * instance of a class, `undefined` in an array, a cycle - refuses the write whole with
 * `STORE_VALUE_NOT_JSON`, nothing of it written; each write says where that comes in its order.
 */
export interface Store {
	/** The name of the state this store reads and writes; also scopes the BroadcastChannel */
	readonly name: string

	// --- Lifecycle ---

	/**
	 * Open the connection (if not already open), once the operations still running have completed;
	 * refused with `STORE_CLOSED` when a `close()` was called after it (the close wins)
	 */
	open(): Promise<void>

	/**
	 * Close this connection: every operation started through it from now on is refused with
	 * `STORE_CLOSED` until `open()` again (`destroy()` excepted); an operation already running
	 * completes. The state of the name stays for the next store of that name and its other connections
	 */
	close(): void

	/**
	 * Delete the state of the name entirely (the database, not just its content), once the operations
	 * still running have completed: every store of the name then reads empty, until something is
	 * registered again.
	 */
	destroy(): Promise<void>

	// --- Cross-realm reconciliation ---

	/**
	 * Bring this connection in sync with the shared persisted state (document
	 * registry + schema) so a subsequent read sees documents imported/removed by
	 * another realm or tab.
	 *
	 * Backend semantics: DexieStore adopts the persisted schema version and
	 * reopens with the full set of per-document tables; a server-backed store
	 * would invalidate its cache / refetch metadata; InMemoryStore is a no-op
	 * (its data is not shared across realms).
	 */
	reconcile(documentId?: string): Promise<void>

	/**
	 * Read-only probe: can this connection serve the document's records right
	 * now? Does not mutate — call reconcile() first to self-heal a stale
	 * connection.
	 */
	isDocumentReadable(documentId: string): Promise<boolean>

	// --- File registry ---

	/**
	 * Register a new document — creates its backing storage partition. An id already registered is
	 * refused with `STORE_DUPLICATE_ID`, the registered document left as it was; then a value that is
	 * not JSON with `STORE_VALUE_NOT_JSON`.
	 */
	registerDocument(file: DocumentRecord): Promise<void>

	/** Get a document record by id */
	getDocument(documentId: string): Promise<DocumentRecord | undefined>

	/** Get all registered documents */
	getDocuments(): Promise<DocumentRecord[]>

	/**
	 * Update a document's name, metadata or import status: a value that is not JSON is refused first
	 * (`STORE_VALUE_NOT_JSON`); a field given as `undefined` is left as it was; a document that is not
	 * registered is then left alone.
	 */
	updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>,
	): Promise<void>

	/** Remove a document, all its records, its history entries and the blobs it owns (O(1) table clear) */
	removeDocument(documentId: string): Promise<void>

	// --- Record access (document-scoped) ---
	// A document that is not in the store (never registered, or removed - here or through another
	// connection) reads as absent: no record, a count of 0. Children come back in the order written.

	/** Get a single record of a document by primary key. */
	get(id: string, documentId: string): Promise<AnyRawRecord | undefined>

	/** Get all records belonging to a document */
	getByDocumentId(documentId: string): Promise<AnyRawRecord[]>

	/**
	 * How many records a document holds; no record is read. It sizes read strategies, so an
	 * implementation may answer from a cache kept in step with its own writes (it may then lag
	 * writes made through another connection).
	 */
	count(documentId: string): Promise<number>

	/** Get records matching a tagName within a specific document */
	getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]>

	/** Get many records by id in one call, ordered like `ids`; a missing id yields `undefined`. */
	getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]>

	// --- Import ---

	/**
	 * Import one file next to the data: register the document `importing`, parse it with the
	 * dialecte's import session, store its records batch by batch, apply the session's writes, mark it
	 * `ready`. Answers the document, its record count and its diagnostics. Whatever fails, or an abort,
	 * leaves nothing of the file and throws the structured error (`PARSE_ERROR`, `IMPORT_ABORTED`,
	 * `IMPORT_FAILED` wrapping anything else). `onProgress` is never awaited; `writeId` is generated
	 * when absent. A store that opens finds no import of a previous run: an unfinished import is
	 * removed when the store opens.
	 */
	importFile(params: ImportFileParams): Promise<ImportFileResult>

	// --- Export ---

	/**
	 * Export one document next to the data: its records read in batches, written as formatted XML (or compact with `indent: false`), answered as one UTF-8 `Blob` and its filename.
	 * Never reads the whole document in one call. A write on the document while it is exported restarts
	 * the export once from the start; a second one fails it with `EXPORT_CONFLICT`. An abort fails it with
	 * `EXPORT_ABORTED`; nothing is left either way. A document that is not registered, or still
	 * `importing`, is refused with `DOCUMENT_NOT_REGISTERED`. `onProgress` is never awaited.
	 */
	exportFile(params: ExportFileParams): Promise<ExportFileResult>

	/**
	 * What became of a write, asked by its id - after a lost connection, before reading again:
	 * `running`, `applied` (the document is ready) or `not-applied` (it failed, was aborted, never
	 * started, or its document was removed since).
	 */
	getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome>

	// --- Writes ---

	/**
	 * Bulk write - atomic creates/updates/deletes bypassing changelog. For import pipeline. Refused
	 * whole, in this order: a document not registered (`DOCUMENT_NOT_REGISTERED`), a create that is
	 * not JSON (`STORE_VALUE_NOT_JSON`), a create of an id the document holds or the batch holds twice
	 * (`STORE_DUPLICATE_ID`, `meta.recordIds`), an update patch that is not JSON. An update patch of an
	 * absent record (whatever it holds) and a delete of an absent id are ignored.
	 */
	bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void>

	/**
	 * Atomic commit — all-or-nothing write scoped to a document, one undoable history entry holding
	 * the whole records before and after. Refused whole, nothing written and no entry kept: a document
	 * not registered (`DOCUMENT_NOT_REGISTERED`), then an update of a record the document does not hold
	 * (`STORE_RECORD_NOT_FOUND`, `meta.recordId`), then a create that is not JSON
	 * (`STORE_VALUE_NOT_JSON`), then a create of an id the document holds or the commit holds twice
	 * (`STORE_DUPLICATE_ID`, `meta.recordIds`), then an update that is not JSON. A delete of an absent
	 * id is ignored.
	 */
	commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void>

	// --- History (document-scoped) ---

	/** Undo the last committed change for a document. No-op at beginning of history. */
	undo(documentId: string): Promise<void>

	/** Redo the next change for a document. No-op at end of history. */
	redo(documentId: string): Promise<void>

	/** Whether undo/redo are currently available for a document */
	getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }>

	/** Return changelog entries for a document in ascending sequenceNumber order */
	getChangeLog(documentId: string): Promise<ChangeLogEntry[]>

	// --- Blob storage ---

	/**
	 * Add a blob: writes the entry to `_blobs` and the binary to `blob_{entry.documentId}`.
	 * The owning document must already be registered.
	 */
	addBlob(entry: BlobRecord, data: Blob): Promise<void>

	/** Get a blob entry + binary data by blob id. */
	getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined>

	/** List blob metadata referenced by a document (via `attachedTo`). No binary data loaded. */
	getBlobsByDocument(documentId: string): Promise<BlobRecord[]>

	/** List blob metadata referenced by a specific record (via `attachedTo`). */
	getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]>

	/** List blob metadata with no `attachedTo` references (standalone project blobs). */
	getStandaloneBlobs(): Promise<BlobRecord[]>

	/** Append a reference to `attachedTo`. No-op if the reference already exists. */
	attachBlob(blobId: string, ref: BlobAttachment): Promise<void>

	/** Remove all references matching `{ documentId, recordRef }` from `attachedTo`. */
	detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void>

	/** Hard-delete a blob: removes from `_blobs` and `blob_{entry.documentId}`. */
	removeBlob(blobId: string): Promise<void>

	/**
	 * Expose the underlying database instance.
	 * Type depends on the implementation (e.g. Dexie for DexieStore).
	 * Cast at the call site when the concrete store type is known.
	 */
	getDatabaseInstance(): unknown
}

/** What a file's import is asked to do: plain data, it crosses a worker boundary as is. */
export type ImportFileOptions = {
	/** Key into the dialecte's configs. Defaults to its default key. */
	configKey?: string
	/** Extensible per-file metadata */
	metadata?: Record<string, unknown>
	/** Override chunking defaults for SAX streaming */
	chunkOptions?: Partial<ChunkOptions>
	/** Use custom record IDs from XML attributes instead of generating UUIDs */
	useCustomRecordsIds?: boolean
}

/** How far an import is: the bytes of the file parsed so far, out of its size. */
export type ImportProgress = {
	bytesRead: number
	totalBytes: number
}

/**
 * What a caller holds over an import that runs: kept apart from the import's data, as a worker call
 * carries the listener as an argument of its own and the abort as a call of its own.
 */
export type ImportControl = {
	/** Told after each stored batch; never awaited, its failure ignored. */
	onProgress?: (progress: ImportProgress) => void
	/** Aborts the import at the next batch: nothing of the file remains, `IMPORT_ABORTED` thrown. */
	signal?: AbortSignal
}

export type ImportFileParams = ImportControl & {
	file: File
	options?: ImportFileOptions
	/** The caller's id for this import, asked by `getWriteOutcome`; generated when absent. */
	writeId?: string
}

/** A file the store imported. */
export type ImportFileResult = {
	/** The document, `ready` */
	record: DocumentRecord
	recordCount: number
	/** What the import session had to say about the file; `[]` when nothing */
	diagnostics: Diagnostic[]
	/** The timings of the import's stages, on the clock of the realm that ran it; with perf on only */
	perf?: PerfSnapshot
}

/** How a document is written: plain data, it crosses a worker boundary as is. */
export type ExportFileOptions = {
	/** Formatted (4 spaces, CRLF, a text value on its element's line); `false` = compact. Default `true`. */
	indent?: boolean
	/** The record id as `_temp-idb-id` on every element. Default `false`. */
	withDatabaseIds?: boolean
	/** Records read per call and written per batch. Default `EXPORT_BATCH_SIZE`. */
	batchSize?: number
}

/** How far an export is: the records written so far, out of the document's. */
export type ExportProgress = {
	recordsWritten: number
	totalRecords: number
}

/** What a caller holds over an export that runs, kept apart from its data as for an import. */
export type ExportControl = {
	/**
	 * Told after each written batch; never awaited, its failure ignored. An export restarted by a write on its
	 * document tells its progress from the start again.
	 */
	onProgress?: (progress: ExportProgress) => void
	/** Aborts the export at the next batch: `EXPORT_ABORTED`, nothing answered. */
	signal?: AbortSignal
}

export type ExportFileParams = ExportControl & {
	documentId: string
	options?: ExportFileOptions
}

/** A document the store exported. */
export type ExportFileResult = {
	/** The document as UTF-8 XML (`application/xml`) */
	file: Blob
	/** The document's name and extension */
	filename: string
	/** The timings of the export's stages, on the clock of the realm that ran it; with perf on only */
	perf?: PerfSnapshot
}

/** What became of a write asked by its id. */
export type WriteOutcome = 'applied' | 'running' | 'not-applied'

export type ChangeLogEntry = {
	/** Auto-increment primary key (assigned by Dexie) */
	id: number
	documentId: string
	sequenceNumber: number
	timestamp: number
	operations: {
		creates: AnyRawRecord[]
		updates: { before: AnyRawRecord; after: AnyRawRecord }[]
		deletes: AnyRawRecord[]
	}
}

/** Per-file head stored in _meta table */
export type ChangeLogMeta = {
	key: string // 'head:{documentId}'
	value: number
}

/**
 * What an import writes through: the store operations `runImport` and the parser call. A store runs
 * its own import against a target of its own, which a `close()` after the import started does not
 * refuse - the import is one operation and completes.
 */
export type ImportTarget = Pick<
	Store,
	'registerDocument' | 'getDocument' | 'updateDocument' | 'removeDocument' | 'bulkWrite'
>

/**
 * What an export reads through: the store's reads, and the version of a document - how many writes it
 * has taken, `undefined` once it is not registered or not `ready`. A store runs its own export against a
 * source of its own, which a `close()` after the export started does not refuse.
 */
export type ExportSource = Pick<
	Store,
	'getDocument' | 'count' | 'getMany' | 'getByTagNameInDocument'
> & {
	getExportVersion(params: { documentId: string }): Promise<number | undefined>
}
