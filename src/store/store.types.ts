import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

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
 */
export interface Store {
	/** Unique identifier for this store — used to scope the BroadcastChannel */
	readonly name: string

	// --- Lifecycle ---

	/** Open the connection (if not already open) */
	open(): Promise<void>

	/** Close the connection */
	close(): void

	/** Delete the database entirely (not just clear — remove from browser) */
	destroy(): Promise<void>

	// --- File registry ---

	/** Register a new document — creates its backing storage partition */
	registerDocument(file: DocumentRecord): Promise<void>

	/** Get a document record by id */
	getDocument(documentId: string): Promise<DocumentRecord | undefined>

	/** Get all registered documents */
	getDocuments(): Promise<DocumentRecord[]>

	/** Update document metadata (name, metadata) */
	updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata'>>,
	): Promise<void>

	/** Remove a document and all its records (O(1) table clear) */
	removeDocument(documentId: string): Promise<void>

	// --- Record access (document-scoped) ---

	/** Get a single record by primary key. documentId optimizes lookup when known. */
	get(id: string, documentId?: string): Promise<AnyRawRecord | undefined>

	/** Get all records belonging to a document */
	getByDocumentId(documentId: string): Promise<AnyRawRecord[]>

	/** Get records matching a tagName within a specific document */
	getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]>

	// --- Writes ---

	/** Bulk write - atomic creates/updates/deletes bypassing changelog. For import pipeline. */
	bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void>

	/** Atomic commit — all-or-nothing write scoped to a document */
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
