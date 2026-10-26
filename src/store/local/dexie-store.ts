import { applyRecordPatch } from '../apply-record-patch'
import { toJsonCopy } from '../json-values'
import { createRunningOperations } from '../running-operations'
import {
	throwDocumentAlreadyRegistered,
	throwDocumentNotRegistered,
	throwDuplicateRecordIds,
	throwRecordToUpdateNotFound,
	throwStoreClosed,
} from '../store-errors'
import {
	TABLE_DOCUMENTS,
	TABLE_CHANGELOG,
	TABLE_META,
	TABLE_BLOBS,
	recordTableName,
	blobTableName,
	DOCUMENTS_SCHEMA,
	CHANGELOG_SCHEMA,
	META_SCHEMA,
	BLOBS_SCHEMA,
	BLOB_DATA_SCHEMA,
} from '../store.constants'
import { removeUnfinishedImports } from '../unfinished-imports'
import { importOutcomeOf } from '../write-outcome'
import { IMPORT_LOCK_PREFIX, VERSION_KEY_PREFIX } from './dexie-store.constants'

import Dexie from 'dexie'

import { throwDialecteError, toDialecteError } from '@/errors'
import { NOOP_PERF } from '@/perf'
import { runExport } from '@/project/io/run-export'
import { runImport } from '@/project/io/run-import'
import { requireStoreRuntime } from '@/project/io/store-runtime'

import type {
	Store,
	ChangeLogEntry,
	ChangeLogMeta,
	ExportFileParams,
	ExportFileResult,
	ExportSource,
	ImportFileParams,
	ImportFileResult,
	ImportTarget,
	RecordSchema,
	WriteOutcome,
} from '../store.types'
import type { DexieStoreOptions, StoredDocumentRow } from './types'
import type { Perf } from '@/perf'
import type { DocumentRecord } from '@/project'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'
import type { Table } from 'dexie'

/** The `_meta` row of a document's version: how many writes it has taken. */
function versionKey(documentId: string): string {
	return `${VERSION_KEY_PREFIX}${documentId}`
}

function importLockName(params: { storeName: string; writeId: string }): string {
	return `${IMPORT_LOCK_PREFIX}${params.storeName}:${params.writeId}`
}

/**
 * Whether an import still runs in some connection of this origin: its lock is held. The lock is
 * asked for, not listed, so an import that takes it after the registry was read is not missed; one
 * without a `writeId` (stored before imports carried one), or where Web Locks are missing, runs nowhere.
 */
async function isImportRunning(params: {
	storeName: string
	document: DocumentRecord
}): Promise<boolean> {
	const { storeName, document } = params
	if (!navigator.locks || document.writeId === undefined) return false
	const name = importLockName({ storeName, writeId: document.writeId })
	return navigator.locks.request(name, { ifAvailable: true }, (lock) => lock === null)
}

/**
 * Translate a backend-agnostic RecordSchema into Dexie's schema DSL string.
 *
 * Dexie format: '++primaryKey, field1, field2, [compound1+compound2], *arrayField'
 */
export function buildDexieSchema(schema: RecordSchema): string {
	const pk = schema.autoIncrement ? `++${schema.primaryKey}` : schema.primaryKey
	const parts: string[] = [pk]

	for (const idx of schema.indexes) {
		parts.push(idx)
	}
	for (const compound of schema.compoundIndexes) {
		parts.push(`[${compound.join('+')}]`)
	}
	for (const arr of schema.arrayIndexes) {
		parts.push(`*${arr}`)
	}

	return parts.join(', ')
}

/** Default minimal schema when none provided */
const DEFAULT_RECORD_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['tagName'],
	compoundIndexes: [],
	arrayIndexes: [],
}

/**
 * DexieStore — IndexedDB-backed Store implementation via Dexie.
 *
 * Manages partitioned tables: one `xel_{documentId}` per registered file.
 * Dynamic schema versioning via close/reopen with version bump.
 *
 * Constructor takes the project name and optionally a RecordSchema from the dialecte config.
 */
export class DexieStore implements Store {
	readonly name: string
	private db: Dexie
	private schemaVersion = 1
	private readonly dexieRecordSchema: string
	/** Dev-only perf helper from the owning Project (no-op unless dev.perf is on). */
	private readonly perf: Perf
	/** The dialecte `importFile` imports with; its imports run in this realm, through `runImport`. */
	private readonly runtime?: StoreRuntime
	/** In-memory file registry - avoids bootstrap connections during close/reopen */
	private knownDocuments: Map<string, DocumentRecord> = new Map()
	/** Serialization lock for schema-changing operations */
	private schemaLock: Promise<void> = Promise.resolve()
	/**
	 * Set when another connection/realm upgraded the shared schema (an import
	 * elsewhere added an xel_<id> table) and IndexedDB closed our connection via
	 * `versionchange`. The next data access self-heals through ensureCurrentSchema.
	 */
	private stale = false
	/**
	 * Record count per document, as `count` last read it. Forgotten after every write this store
	 * makes to the document (IndexedDB counts by iterating: about 50 ms for 90,000 records).
	 */
	private readonly recordCounts = new Map<string, number>()
	/** Set by `close()`, cleared by `open()`: a closed store refuses every operation started after it. */
	private closed = false
	/** How many times `close()` was called: an `open()` refuses when one came after it was called. */
	private closings = 0
	/** The operations running: `close()` closes the connection, `open()` and `destroy()` go on, once none is left. */
	private readonly operations = createRunningOperations()

	constructor(projectName: string, options?: DexieStoreOptions) {
		this.name = projectName
		this.dexieRecordSchema = buildDexieSchema(options?.recordSchema ?? DEFAULT_RECORD_SCHEMA)
		this.perf = options?.perf ?? NOOP_PERF
		this.runtime = options?.runtime
		this.db = new Dexie(projectName)
	}

	// --- Lifecycle ---

	/**
	 * Open: an import found unfinished is removed - unless a connection still runs it (its Web Lock
	 * is held). Where Web Locks are missing, every unfinished import is removed.
	 */
	async open(): Promise<void> {
		const closingsAtCall = this.closings
		// an operation still running keeps its connection: the store opens once it is done
		await this.operations.whenIdle()
		// a close() called after this open() wins: the store stays closed
		if (this.closings !== closingsAtCall) throwStoreClosed({ storeName: this.name })
		this.closed = false
		// counted as an operation: a close() meanwhile closes the connection this reopens
		await this.tracked(async () => {
			await this.reloadFromPersisted()
			await removeUnfinishedImports({
				store: this,
				isRunning: (document) => isImportRunning({ storeName: this.name, document }),
			})
		})
	}

	/**
	 * Refuse every operation started from now on until opened again; the connection itself closes once
	 * the operations running complete. The database stays.
	 */
	close(): void {
		this.closed = true
		this.closings += 1
		if (this.operations.count === 0) this.db.close()
	}

	async destroy(): Promise<void> {
		// an operation still running completes before the database goes
		await this.operations.whenIdle()
		if (this.db.isOpen()) {
			this.db.close()
			await tick()
		}
		await Dexie.delete(this.name)
		this.knownDocuments.clear()
		this.recordCounts.clear()
	}

	// --- Cross-realm reconciliation ---

	/**
	 * Bring this connection in sync with the shared persisted state (document
	 * registry + schema). Used by the owning Project when a cross-realm import /
	 * removal broadcast arrives, so a subsequent read sees the new partition.
	 */
	async reconcile(): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
		})
	}

	/**
	 * Read-only probe: can this connection serve the document's records right now?
	 * True only when the document is registered here and its backing table exists
	 * in the current schema. Does not mutate - call reconcile() first to self-heal.
	 */
	async isDocumentReadable(documentId: string): Promise<boolean> {
		return this.operation(async () => {
			if (!this.knownDocuments.has(documentId)) return false
			const tableName = this.resolveTableName(documentId)
			return this.db.isOpen() && this.db.tables.some((t) => t.name === tableName)
		})
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		return this.operation(() => this.registerDocumentUnguarded(file))
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.operation(() => this.getDocumentUnguarded(documentId))
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const rows = await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).toArray()
			return rows.map(withStatus)
		})
	}

	async updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>,
	): Promise<void> {
		return this.operation(() => this.updateDocumentUnguarded(documentId, updates))
	}

	async removeDocument(documentId: string): Promise<void> {
		return this.operation(() => this.removeDocumentUnguarded(documentId))
	}

	// --- Record access ---

	async get(id: string, documentId: string): Promise<AnyRawRecord | undefined> {
		return this.operation(async () => {
			const table = await this.recordTable(documentId)
			return table?.get(id)
		})
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return this.operation(async () => {
			const table = await this.recordTable(documentId)
			return table ? table.toArray() : []
		})
	}

	async count(documentId: string): Promise<number> {
		return this.operation(() => this.countUnguarded(documentId))
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		return this.operation(() => this.getByTagNameInDocumentUnguarded(tagName, documentId))
	}

	async getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]> {
		return this.operation(() => this.getManyUnguarded(ids, documentId))
	}

	// --- Import ---

	/** Runs in this realm, holding a Web Lock for the import so another connection's `open` keeps it. */
	async importFile(params: ImportFileParams): Promise<ImportFileResult> {
		return this.operation(async () => {
			const { file, options, writeId = crypto.randomUUID(), onProgress, signal } = params
			const runtime = requireStoreRuntime({
				runtime: this.runtime,
				storeName: this.name,
				operation: 'import',
			})
			const run = () =>
				runImport(
					{ store: this.ownImportTarget(), runtime, file, options, writeId },
					{ onProgress, signal },
				)
			if (!navigator.locks) return run()
			return navigator.locks.request(importLockName({ storeName: this.name, writeId }), run)
		})
	}

	// --- Export ---

	async exportFile(params: ExportFileParams): Promise<ExportFileResult> {
		return this.operation(async () => {
			const { documentId, options, onProgress, signal } = params
			const runtime = requireStoreRuntime({
				runtime: this.runtime,
				storeName: this.name,
				operation: 'export',
			})
			return runExport(
				{ source: this.ownExportSource(), runtime, documentId, options },
				{ onProgress, signal },
			)
		})
	}

	async getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome> {
		return this.operation(async () => {
			return importOutcomeOf({ documents: await this.getDocuments(), writeId: params.writeId })
		})
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		return this.operation(() => this.bulkWriteUnguarded(documentId, ops))
	}

	async commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		return this.operation(async () => {
			try {
				const { documentId, creates, updates, deletes, onProgress } = params
				const table = await this.writeTable(documentId)
				const total = creates.length + updates.length + deletes.length
				let completed = 0

				try {
					await this.db.transaction(
						'rw',
						table,
						this.db.table(TABLE_CHANGELOG),
						this.db.table(TABLE_META),
						async () => {
							// Snapshot before-state for undo; an update of a record the document does not
							// hold aborts the commit before anything is written
							const beforeSnapshots = await snapshotBefore({ table, updates, documentId })
							const deletedSnapshots: (AnyRawRecord | undefined)[] =
								deletes.length > 0 ? await table.bulkGet(deletes) : []

							// every refusal before the first progress: a create that is not JSON, a taken id,
							// then an update that is not JSON
							const created = toJsonCopy({ value: creates })
							if (created.length > 0) await addRecords({ table, creates: created, documentId })
							const updated = toJsonCopy({ value: updates })
							if (created.length > 0) {
								completed += created.length
								onProgress(completed, total)
							}

							if (updated.length > 0) {
								try {
									await table.bulkPut(updated)
									completed += updates.length
									onProgress(completed, total)
								} catch (error) {
									throwDialecteError('STORE_BULK_UPDATE_FAILED', {
										detail: error instanceof Error ? error.message : String(error),
										cause: error instanceof Error ? error : undefined,
									})
								}
							}

							if (deletes.length > 0) {
								try {
									await table.bulkDelete(deletes)
									completed += deletes.length
									onProgress(completed, total)
								} catch (error) {
									throwDialecteError('STORE_DELETE_FAILED', {
										detail: error instanceof Error ? error.message : String(error),
										cause: error instanceof Error ? error : undefined,
									})
								}
							}

							// Trim redoable future for this file
							const head = await this.getHead(documentId)
							const allForFile = await this.db
								.table<ChangeLogEntry>(TABLE_CHANGELOG)
								.where({ documentId })
								.filter((e) => e.sequenceNumber > head)
								.toArray()
							if (allForFile.length > 0) {
								await this.db.table(TABLE_CHANGELOG).bulkDelete(allForFile.map((e) => e.id))
							}

							const newSeq = head + 1
							const entry: Omit<ChangeLogEntry, 'id'> = {
								documentId,
								sequenceNumber: newSeq,
								timestamp: Date.now(),
								operations: {
									creates: created,
									updates: updated.map((after, i) => ({ before: beforeSnapshots[i], after })),
									deletes: deletedSnapshots.filter(Boolean) as AnyRawRecord[],
								},
							}
							await this.db.table(TABLE_CHANGELOG).add(entry)
							await this.setHead(documentId, newSeq)
							await this.bumpVersion(documentId)
						},
					)
				} catch (error) {
					if (toDialecteError(error)) throw error
					throwDialecteError('STORE_COMMIT_FAILED', {
						detail: error instanceof Error ? error.message : String(error),
						cause: error instanceof Error ? error : undefined,
					})
				}
			} finally {
				this.recordCounts.delete(params.documentId)
			}
		})
	}

	// --- History ---

	async undo(documentId: string): Promise<void> {
		return this.operation(async () => {
			try {
				await this.ensureCurrentSchema()
				const head = await this.getHead(documentId)
				if (head === 0) return

				const entry = await this.db
					.table<ChangeLogEntry>(TABLE_CHANGELOG)
					.where({ documentId, sequenceNumber: head })
					.first()
				if (!entry) return

				const table = this.db.table<AnyRawRecord>(this.resolveTableName(documentId))

				await this.db.transaction('rw', table, this.db.table(TABLE_META), async () => {
					const { creates, updates, deletes } = entry.operations

					if (creates.length > 0) {
						await table.bulkDelete(creates.map((r) => r.id))
					}
					if (updates.length > 0) {
						await table.bulkPut(updates.map((u) => u.before))
					}
					if (deletes.length > 0) {
						await table.bulkAdd(deletes)
					}

					await this.setHead(documentId, head - 1)
					await this.bumpVersion(documentId)
				})
			} finally {
				this.recordCounts.delete(documentId)
			}
		})
	}

	async redo(documentId: string): Promise<void> {
		return this.operation(async () => {
			try {
				await this.ensureCurrentSchema()
				const head = await this.getHead(documentId)
				const next = head + 1

				const entry = await this.db
					.table<ChangeLogEntry>(TABLE_CHANGELOG)
					.where({ documentId, sequenceNumber: next })
					.first()
				if (!entry) return

				const table = this.db.table<AnyRawRecord>(this.resolveTableName(documentId))

				await this.db.transaction('rw', table, this.db.table(TABLE_META), async () => {
					const { creates, updates, deletes } = entry.operations

					if (creates.length > 0) {
						await table.bulkAdd(creates)
					}
					if (updates.length > 0) {
						await table.bulkPut(updates.map((update) => update.after))
					}
					if (deletes.length > 0) {
						await table.bulkDelete(deletes.map((record) => record.id))
					}

					await this.setHead(documentId, next)
					await this.bumpVersion(documentId)
				})
			} finally {
				this.recordCounts.delete(documentId)
			}
		})
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const head = await this.getHead(documentId)
			const next = await this.db
				.table<ChangeLogEntry>(TABLE_CHANGELOG)
				.where({ documentId, sequenceNumber: head + 1 })
				.first()
			return { canUndo: head > 0, canRedo: next !== undefined }
		})
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			return this.db
				.table<ChangeLogEntry>(TABLE_CHANGELOG)
				.where({ documentId })
				.sortBy('sequenceNumber')
		})
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			invariantBlobOwnerKnown(this.knownDocuments, entry.documentId)
			const blobTable = this.db.table<{ id: string; data: Blob }>(blobTableName(entry.documentId))
			await this.db.transaction('rw', this.db.table(TABLE_BLOBS), blobTable, async () => {
				await this.db.table<BlobRecord>(TABLE_BLOBS).put(entry)
				await blobTable.put({ id: entry.id, data })
			})
		})
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
			if (!entry) return undefined
			const row = await this.db
				.table<{ id: string; data: Blob }>(blobTableName(entry.documentId))
				.get(blobId)
			if (!row) return undefined
			return { entry, data: row.data }
		})
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
			return all.filter((b) => b.attachedTo.some((a) => a.documentId === documentId))
		})
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
			return all.filter((b) =>
				b.attachedTo.some((a) => a.documentId === documentId && a.recordRef === recordRef),
			)
		})
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
			return all.filter((b) => b.attachedTo.length === 0)
		})
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
			if (!entry) {
				throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
			}
			const exists = entry.attachedTo.some(
				(a) =>
					a.documentId === ref.documentId &&
					a.recordRef === ref.recordRef &&
					a.attribute === ref.attribute,
			)
			if (exists) return
			const attachedTo = [...entry.attachedTo, ref]
			await this.db.table<BlobRecord>(TABLE_BLOBS).update(blobId, { attachedTo })
		})
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
			if (!entry) {
				throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
			}
			const attachedTo = entry.attachedTo.filter(
				(a) => !(a.documentId === ref.documentId && a.recordRef === ref.recordRef),
			)
			await this.db.table<BlobRecord>(TABLE_BLOBS).update(blobId, { attachedTo })
		})
	}

	async removeBlob(blobId: string): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
			if (!entry) return
			const blobTable = this.db.table<{ id: string }>(blobTableName(entry.documentId))
			await this.db.transaction('rw', this.db.table(TABLE_BLOBS), blobTable, async () => {
				await blobTable.delete(blobId)
				await this.db.table(TABLE_BLOBS).delete(blobId)
			})
		})
	}

	/**
	 * Expose the underlying Dexie instance.
	 * Useful for legacy compatibility layers and advanced testing.
	 */
	getDatabaseInstance(): Dexie {
		return this.db
	}

	/**
	 * One operation of the port: refused once the store is closed; counted while it runs, so a
	 * `close()` meanwhile lets it complete and closes the connection after it.
	 */
	private async operation<GenericResult>(
		run: () => Promise<GenericResult>,
	): Promise<GenericResult> {
		if (this.closed) throwStoreClosed({ storeName: this.name })
		return this.tracked(run)
	}

	/** Counted while it runs; the last one to end on a closed store closes the connection. */
	private async tracked<GenericResult>(run: () => Promise<GenericResult>): Promise<GenericResult> {
		this.operations.start()
		try {
			return await run()
		} finally {
			// closed before `end` resolves a waiting open(), which then reopens
			if (this.operations.count === 1 && this.closed) this.db.close()
			this.operations.end()
		}
	}

	/**
	 * The target the store's own import writes through: the import is one operation, so a `close()`
	 * after it started does not refuse the calls it makes (each still counted while it runs).
	 */
	private ownImportTarget(): ImportTarget {
		return {
			registerDocument: (file) => this.tracked(() => this.registerDocumentUnguarded(file)),
			getDocument: (documentId) => this.tracked(() => this.getDocumentUnguarded(documentId)),
			updateDocument: (documentId, updates) =>
				this.tracked(() => this.updateDocumentUnguarded(documentId, updates)),
			removeDocument: (documentId) => this.tracked(() => this.removeDocumentUnguarded(documentId)),
			bulkWrite: (documentId, ops) => this.tracked(() => this.bulkWriteUnguarded(documentId, ops)),
		}
	}

	/**
	 * The source the store's own export reads through: the export is one operation, so a `close()` after it
	 * started does not refuse the reads it makes (each still counted while it runs).
	 */
	private ownExportSource(): ExportSource {
		return {
			getDocument: (documentId) => this.tracked(() => this.getDocumentUnguarded(documentId)),
			// counted afresh: a write through another connection is not in this connection's count
			count: (documentId) => this.tracked(() => this.countStored(documentId)),
			getByTagNameInDocument: (tagName, documentId) =>
				this.tracked(() => this.getByTagNameInDocumentUnguarded(tagName, documentId)),
			getMany: (ids, documentId) => this.tracked(() => this.getManyUnguarded(ids, documentId)),
			getExportVersion: (params) => this.tracked(() => this.getExportVersion(params)),
		}
	}

	private async registerDocumentUnguarded(file: DocumentRecord): Promise<void> {
		await this.withSchemaLock(async () => {
			if (this.stale) await this.reloadFromPersisted()
			// Best effort on one connection: two connections registering the same id at the same time
			// are not serialised here (core registers fresh uuids only).
			if (this.knownDocuments.has(file.id)) throwDocumentAlreadyRegistered({ documentId: file.id })
			const document = toJsonCopy({ value: file })
			this.knownDocuments.set(document.id, document)
			await this.reopenWithNewSchema()
			await this.db.table(TABLE_DOCUMENTS).add(document)
		})
	}

	private async getDocumentUnguarded(documentId: string): Promise<DocumentRecord | undefined> {
		await this.ensureCurrentSchema()
		const row = await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).get(documentId)
		return row && withStatus(row)
	}

	private async updateDocumentUnguarded(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>,
	): Promise<void> {
		const checked = toJsonCopy({ value: updates })
		await this.ensureCurrentSchema()
		await this.db.table(TABLE_DOCUMENTS).update(documentId, checked)
		const existing = this.knownDocuments.get(documentId)
		if (existing) {
			this.knownDocuments.set(documentId, { ...existing, ...checked })
		}
	}

	private async removeDocumentUnguarded(documentId: string): Promise<void> {
		try {
			await this.withSchemaLock(async () => {
				if (this.stale) await this.reloadFromPersisted()
				// One transaction: a reader sees the document whole or not registered, never half cleared
				const tableName = this.resolveTableName(documentId)
				const blobTable = blobTableName(documentId)
				const ownTables = [tableName, blobTable].filter((name) =>
					this.db.tables.some((table) => table.name === name),
				)
				await this.db.transaction(
					'rw',
					[...ownTables, TABLE_BLOBS, TABLE_CHANGELOG, TABLE_META, TABLE_DOCUMENTS],
					async () => {
						// records and blob data first (O(1) table clears)
						for (const name of ownTables) await this.db.table(name).clear()
						await this.db.table<BlobRecord>(TABLE_BLOBS).where({ documentId }).delete()
						await this.db.table<ChangeLogEntry>(TABLE_CHANGELOG).where({ documentId }).delete()
						// the version row stays: a document registered again under the id goes on from it
						await this.db.table(TABLE_META).delete(`head:${documentId}`)
						await this.db.table(TABLE_DOCUMENTS).delete(documentId)
					},
				)

				// Remove from memory and reopen (null table = Dexie drop)
				this.knownDocuments.delete(documentId)
				await this.reopenWithNewSchema({ drop: documentId })
			})
		} finally {
			this.recordCounts.delete(documentId)
		}
	}

	private async bulkWriteUnguarded(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		try {
			const { updates, deletes } = ops
			const table = await this.writeTable(documentId)
			// refused in the order every store answers in: a create that is not JSON, a taken id, then
			// a patch that is not JSON - of the patches that apply: one of a record the document does
			// not hold is skipped
			const creates = toJsonCopy({ value: ops.creates ?? [] })

			await this.db.transaction('rw', table, this.db.table(TABLE_META), async () => {
				if (creates.length > 0) {
					this.perf.start('core::store::bulkWrite::add')
					await addRecords({ table, creates, documentId })
					this.perf.stop('core::store::bulkWrite::add')
				}

				if (updates?.length) {
					this.perf.start('core::store::bulkWrite::update')
					try {
						for (const patch of updates) {
							const record = await table.get(patch.recordId)
							if (!record) continue
							const checked = toJsonCopy({ value: patch })
							await table.put(applyRecordPatch({ record, patch: checked }))
						}
					} catch (error) {
						if (toDialecteError(error)) throw error
						throwDialecteError('STORE_BULK_UPDATE_FAILED', {
							detail: error instanceof Error ? error.message : String(error),
							cause: error instanceof Error ? error : undefined,
						})
					}
					this.perf.stop('core::store::bulkWrite::update')
				}

				if (deletes?.length) {
					this.perf.start('core::store::bulkWrite::delete')
					await table.bulkDelete(deletes)
					this.perf.stop('core::store::bulkWrite::delete')
				}
				await this.bumpVersion(documentId)
			})
		} finally {
			this.recordCounts.delete(documentId)
		}
	}

	// --- Private helpers ---

	private async getHead(documentId: string): Promise<number> {
		const meta = await this.db.table<ChangeLogMeta>(TABLE_META).get(`head:${documentId}`)
		return meta?.value ?? 0
	}

	private async setHead(documentId: string, value: number): Promise<void> {
		await this.db.table<ChangeLogMeta>(TABLE_META).put({ key: `head:${documentId}`, value })
	}

	/** A write landed on the document: its version moves on, inside the write's transaction. */
	private async bumpVersion(documentId: string): Promise<void> {
		const meta = this.db.table<ChangeLogMeta>(TABLE_META)
		const current = await meta.get(versionKey(documentId))
		await meta.put({ key: versionKey(documentId), value: (current?.value ?? 0) + 1 })
	}

	/** How many writes a `ready` document has taken, read with its registry row in one transaction. */
	private async getExportVersion(params: { documentId: string }): Promise<number | undefined> {
		const { documentId } = params
		await this.ensureCurrentSchema()
		const documents = this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS)
		const meta = this.db.table<ChangeLogMeta>(TABLE_META)
		return this.db.transaction('r', documents, meta, async () => {
			const row = await documents.get(documentId)
			if (!row || withStatus(row).status !== 'ready') return undefined
			return (await meta.get(versionKey(documentId)))?.value ?? 0
		})
	}

	private async countUnguarded(documentId: string): Promise<number> {
		// a connection made stale by another one forgets its counts before answering from them
		await this.ensureCurrentSchema()
		const known = this.recordCounts.get(documentId)
		if (known !== undefined) return known
		const table = await this.recordTable(documentId)
		if (!table) return 0
		const count = await table.count()
		this.recordCounts.set(documentId, count)
		return count
	}

	private async countStored(documentId: string): Promise<number> {
		const table = await this.recordTable(documentId)
		return table ? table.count() : 0
	}

	private async getByTagNameInDocumentUnguarded(
		tagName: string,
		documentId: string,
	): Promise<AnyRawRecord[]> {
		const table = await this.recordTable(documentId)
		return table ? table.where({ tagName }).toArray() : []
	}

	private async getManyUnguarded(
		ids: string[],
		documentId: string,
	): Promise<(AnyRawRecord | undefined)[]> {
		const table = await this.recordTable(documentId)
		return table ? table.bulkGet(ids) : ids.map(() => undefined)
	}

	/** Build Dexie stores object from current knownDocuments */
	private buildStores(options?: { drop?: string }): Record<string, string | null> {
		const stores: Record<string, string | null> = {
			[TABLE_DOCUMENTS]: buildDexieSchema(DOCUMENTS_SCHEMA),
			[TABLE_CHANGELOG]: buildDexieSchema(CHANGELOG_SCHEMA),
			[TABLE_META]: buildDexieSchema(META_SCHEMA),
			[TABLE_BLOBS]: buildDexieSchema(BLOBS_SCHEMA),
		}
		const blobDataSchema = buildDexieSchema(BLOB_DATA_SCHEMA)
		for (const fId of this.knownDocuments.keys()) {
			stores[this.resolveTableName(fId)] = this.dexieRecordSchema
			stores[blobTableName(fId)] = blobDataSchema
		}
		// Null out a dropped table (Dexie convention for table removal)
		if (options?.drop) {
			stores[this.resolveTableName(options.drop)] = null
			stores[blobTableName(options.drop)] = null
		}
		return stores
	}

	/** Close DB, bump version, reopen with updated schema */
	private async reopenWithNewSchema(options?: { drop?: string }): Promise<void> {
		this.perf.start('core::store::reopenSchema')
		try {
			this.db.close()
			await tick()
			this.schemaVersion++
			this.db = new Dexie(this.name)
			this.db.version(this.schemaVersion).stores(this.buildStores(options))
			this.attachVersionChangeHandler()
			await this.db.open()
			// Persist schema version
			await this.db.table(TABLE_META).put({ key: 'schemaVersion', value: this.schemaVersion })
			this.stale = false
		} finally {
			this.perf.stop('core::store::reopenSchema')
		}
	}

	/**
	 * (Re)build this connection from persisted state: read the document registry
	 * and schema version written by any realm, then open the main connection with
	 * the full set of per-document tables. Used on open() and to self-heal after a
	 * foreign schema change (see attachVersionChangeHandler / ensureCurrentSchema).
	 */
	private async reloadFromPersisted(): Promise<void> {
		this.recordCounts.clear()
		if (this.db.isOpen()) {
			this.db.close()
			await tick()
		}

		// Bootstrap: open with system tables only to read existing state
		const bootstrap = new Dexie(this.name)
		bootstrap.version(1).stores({
			[TABLE_DOCUMENTS]: buildDexieSchema(DOCUMENTS_SCHEMA),
			[TABLE_CHANGELOG]: buildDexieSchema(CHANGELOG_SCHEMA),
			[TABLE_META]: buildDexieSchema(META_SCHEMA),
			[TABLE_BLOBS]: buildDexieSchema(BLOBS_SCHEMA),
		})

		try {
			await bootstrap.open()
			const rows: StoredDocumentRow[] = await bootstrap.table(TABLE_DOCUMENTS).toArray()
			const files = rows.map(withStatus)
			const meta = await bootstrap.table(TABLE_META).get('schemaVersion')
			bootstrap.close()

			// Persisted registry is the source of truth - replace, don't merge, so a
			// removal in another realm is reflected here too.
			this.knownDocuments = new Map(files.map((f) => [f.id, f]))
			this.schemaVersion = meta?.value ?? 1
		} catch {
			// Fresh DB - no existing data
			bootstrap.close()
		}

		// Open with full schema (all known file tables)
		this.db = new Dexie(this.name)
		this.db.version(this.schemaVersion).stores(this.buildStores())
		this.attachVersionChangeHandler()
		await this.db.open()
		this.stale = false
	}

	/**
	 * Release this connection when another realm/connection upgrades the shared
	 * schema (e.g. a document imported elsewhere adds an xel_<id> table). Closing
	 * unblocks the other connection's upgrade; the stale flag makes the next data
	 * access self-heal via ensureCurrentSchema.
	 */
	private attachVersionChangeHandler(): void {
		this.db.on('versionchange', () => {
			this.db.close()
			this.stale = true
		})
	}

	/**
	 * Guard run before every data access. Cheap no-op unless a foreign schema
	 * change flagged this connection stale, in which case it rebuilds the
	 * connection from persisted state before the access proceeds.
	 */
	private async ensureCurrentSchema(): Promise<void> {
		if (!this.stale) return
		await this.withSchemaLock(async () => {
			if (this.stale) await this.reloadFromPersisted()
		})
	}

	/** Serialize schema-changing operations */
	private withSchemaLock(fn: () => Promise<void>): Promise<void> {
		this.schemaLock = this.schemaLock.then(fn, fn)
		return this.schemaLock
	}

	/**
	 * Resolve the Dexie table name for a documentId.
	 */
	private resolveTableName(documentId: string): string {
		return recordTableName(documentId)
	}

	/** The record table of a document to write; a document that is not registered takes no write. */
	private async writeTable(documentId: string): Promise<Table<AnyRawRecord>> {
		const table = await this.recordTable(documentId)
		if (!table) throwDocumentNotRegistered({ documentId, what: 'records' })
		return table
	}

	/**
	 * The record table of a document, once this connection is current - or nothing when the
	 * document is not in the store (never registered, or removed here or in another realm): a read
	 * of it answers empty, it is not a backend error.
	 */
	private async recordTable(documentId: string): Promise<Table<AnyRawRecord> | undefined> {
		await this.ensureCurrentSchema()
		const tableName = this.resolveTableName(documentId)
		if (!this.db.tables.some((table) => table.name === tableName)) return undefined
		return this.db.table<AnyRawRecord>(tableName)
	}
}

/** Yield one microtask to let IndexedDB release connections */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Add records to a document's table: an id the document already holds refuses the whole batch
 * (`STORE_DUPLICATE_ID`, the transaction around it rolls back); any other failure is
 * `STORE_BULK_ADD_FAILED`.
 */
async function addRecords(params: {
	table: Table<AnyRawRecord>
	creates: AnyRawRecord[]
	documentId: string
}): Promise<void> {
	const { table, creates, documentId } = params
	try {
		await table.bulkAdd(creates)
	} catch (error) {
		const cause = error instanceof Error ? error : undefined
		const duplicates = duplicateKeyPositions(error)
		if (duplicates) {
			// a failed row whose id an earlier row of the batch already gives is a repeat; any other
			// failed row's id is held by the document
			const failed = duplicates.map((position) => ({ position, id: creates[position].id }))
			function isRepeat(row: { position: number; id: string }): boolean {
				return creates.findIndex((record) => record.id === row.id) < row.position
			}
			throwDuplicateRecordIds({
				documentId,
				held: failed.filter((row) => !isRepeat(row)).map((row) => row.id),
				repeated: failed.filter(isRepeat).map((row) => row.id),
				cause,
			})
		}
		throwDialecteError('STORE_BULK_ADD_FAILED', {
			detail: error instanceof Error ? error.message : String(error),
			cause,
		})
	}
}

/**
 * IndexedDB refuses an existing key with a ConstraintError, one per failed row of a bulk add: the
 * positions of those rows, or nothing when the failure is another one.
 */
function duplicateKeyPositions(error: unknown): number[] | undefined {
	if (!(error instanceof Dexie.BulkError)) return undefined
	const positions = Object.entries(error.failuresByPos)
		.filter(([, failure]) => failure.name === 'ConstraintError')
		.map(([position]) => Number(position))
	return positions.length > 0 ? positions : undefined
}

/** The records as they are before an update, every one of them: an absent one refuses the commit. */
async function snapshotBefore(params: {
	table: Table<AnyRawRecord>
	updates: AnyRawRecord[]
	documentId: string
}): Promise<AnyRawRecord[]> {
	const { table, updates, documentId } = params
	if (updates.length === 0) return []
	const found = await table.bulkGet(updates.map((record) => record.id))
	return found.map((before, index) => {
		if (!before) throwRecordToUpdateNotFound({ documentId, recordId: updates[index].id })
		return before
	})
}

function invariantBlobOwnerKnown(known: Map<string, DocumentRecord>, documentId: string): void {
	if (!known.has(documentId)) throwDocumentNotRegistered({ documentId, what: 'a blob' })
}

/** A row stored before `status` existed is a finished import: it reads as `ready`. */
function withStatus(row: StoredDocumentRow): DocumentRecord {
	return row.status ? (row as DocumentRecord) : { ...row, status: 'ready' }
}
