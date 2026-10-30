import { applyRecordPatch } from '../apply-record-patch'
import { createClosingConnections } from '../closing-connections'
import { tellCommitProgress } from '../commit-progress'
import { applyDocumentUpdates, assertDocumentPlace } from '../document-path'
import { ignoreDestroyOutcome } from '../ignore-destroy-outcome'
import { checkWriteId, toJsonCopy } from '../json-values'
import { createOpenConnections } from '../open-connections'
import { createRunningOperations } from '../running-operations'
import {
	throwDocumentAlreadyRegistered,
	throwDocumentNotRegistered,
	throwDuplicateRecordIds,
	throwOpenElsewhere,
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
import { toStoredRecords } from '../stored-record'
import { removeUnfinishedImports } from '../unfinished-imports'
import { writeOutcomeOf } from '../write-outcome'
import {
	DESTROY_LOCK_ASK_INTERVAL_MS,
	DESTROY_LOCK_WAIT_MS,
	DISCARDED_SEQUENCE,
	IMPORT_LOCK_PREFIX,
	OPEN_LOCK_PREFIX,
	VERSION_KEY_PREFIX,
} from './dexie-store.constants'

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
import type { DocumentRecord, DocumentUpdates } from '@/project'
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

/** The local connections of each name open in this realm: the count a destroy reads where there are no Web Locks. */
const OPEN_LOCAL_CONNECTIONS = createOpenConnections()
/** The local connections of each name closed with operations running, in this realm: a destroy of the name lets them complete first. */
const CLOSING_LOCAL_CONNECTIONS = createClosingConnections()

/** The destroys of each name in this realm, in turn: settled when the last one called has. */
const LOCAL_DESTROY_TURNS = new Map<string, Promise<void>>()

/** `run` once every destroy of the name called before it in this realm has settled. */
function inDestroyTurn(params: { name: string; run: () => Promise<void> }): Promise<void> {
	const { name, run } = params
	const turn = (LOCAL_DESTROY_TURNS.get(name) ?? Promise.resolve()).then(run)
	const settled = turn.catch(ignoreDestroyOutcome)
	LOCAL_DESTROY_TURNS.set(name, settled)
	void settled.then(function forgetTurn() {
		if (LOCAL_DESTROY_TURNS.get(name) === settled) LOCAL_DESTROY_TURNS.delete(name)
	})
	return turn
}

/** A hold of the open lock let go, once granted. */
function letHoldGo(release: () => void): void {
	release()
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
	/**
	 * This connection's shared hold of the open lock, from its ask until let go: its release once
	 * granted (none while this connection holds none).
	 */
	private openHold: Promise<() => void> | undefined
	/** This store's own destroy while it runs: an operation started meanwhile goes on once it has ended. */
	private destroying: Promise<void> | undefined
	/** Settles once this connection's last hold of the open lock is let go for good. */
	private openHoldEnded: Promise<unknown> = Promise.resolve()

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
		// an operation still running keeps its connection: the store opens once it is done, and once its
		// own destroy has ended
		await this.operations.whenIdle()
		while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
		// a close() called after this open() wins: the store stays closed
		if (this.closings !== closingsAtCall) throwStoreClosed({ storeName: this.name })
		this.closed = false
		await this.holdOpen()
		// counted as an operation: a close() meanwhile closes the connection this reopens
		await this.tracked(async () => {
			await this.reloadFromPersisted()
			await removeUnfinishedImports({
				store: this.ownSweepTarget(),
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
		if (this.operations.count === 0) {
			this.letOpenHoldGo()
			this.db.close()
			return
		}
		this.holdUntilIdle()
	}

	/**
	 * Closed with operations running: its hold of the open lock is let go once they end - a destroy of
	 * another tab is refused until then, as a SQLite store of another tab counts - and a destroy of the
	 * name in this realm lets them complete first.
	 */
	private holdUntilIdle(): void {
		const hold = this.openHold
		const holdEnded = this.openHoldEnded
		// an open() after this close() takes a hold of its own
		this.openHold = undefined
		const until = this.operations.whenIdle().then(function letGoOnceIdle() {
			void hold?.then(letHoldGo)
			return holdEnded
		})
		CLOSING_LOCAL_CONNECTIONS.markClosing({ name: this.name, until })
	}

	/**
	 * Delete the database, once the operations running complete; refused `PROJECT_OPEN_ELSEWHERE` while
	 * another connection - of this tab or another - is open, nothing removed.
	 */
	async destroy(): Promise<void> {
		// one destroy of this store at a time: another one called meanwhile starts once it has ended
		while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
		const destroying = this.destroyOnceIdle()
		this.destroying = destroying
		try {
			await destroying
		} finally {
			if (this.destroying === destroying) this.destroying = undefined
		}
	}

	private async destroyOnceIdle(): Promise<void> {
		// an operation still running completes before the database goes
		await this.operations.whenIdle()
		// one destroy of the name at a time in this realm: none finds another's hold let go meanwhile
		await inDestroyTurn({ name: this.name, run: this.destroyIfAlone.bind(this) })
	}

	private async destroyIfAlone(): Promise<void> {
		const closingsAtCall = this.closings
		// a store never opened, or closed, holds none: refused, it takes none
		const wasOpen = this.openHold !== undefined
		this.letOpenHoldGo()
		// its own hold let go for good first, and the holds of the connections of the realm closed with
		// operations running: the lock is then free unless another connection holds it
		await this.openHoldEnded
		await CLOSING_LOCAL_CONNECTIONS.settled({ name: this.name })
		const destroyed = navigator.locks
			? await this.deleteWhenAlone()
			: await this.deleteWhenAloneInRealm()
		if (destroyed) return
		// refused: this connection stays as it was, unless closed meanwhile
		if (wasOpen && this.closings === closingsAtCall) await this.holdOpen()
		throwOpenElsewhere({ storeName: this.name })
	}

	/**
	 * The database deleted under the open lock had alone - waited for a moment, as a connection closed
	 * just before lets it go asynchronously; `false` when another connection still holds it.
	 */
	private async deleteWhenAlone(): Promise<boolean> {
		const deadline = performance.now() + DESTROY_LOCK_WAIT_MS
		for (;;) {
			const destroyed = await navigator.locks.request(
				`${OPEN_LOCK_PREFIX}${this.name}`,
				{ mode: 'exclusive', ifAvailable: true },
				this.deleteIfAlone.bind(this),
			)
			if (destroyed) return true
			if (performance.now() >= deadline) return false
			await new Promise(function waitAMoment(resolve) {
				setTimeout(resolve, DESTROY_LOCK_ASK_INTERVAL_MS)
			})
		}
	}

	/** The database deleted when the open lock is had alone; nothing done when another connection holds it. */
	private async deleteIfAlone(lock: Lock | null): Promise<boolean> {
		if (lock === null) return false
		return this.deleteDatabase()
	}

	/** With no Web Locks: the database deleted when no other connection of the realm is open, as above. */
	private async deleteWhenAloneInRealm(): Promise<boolean> {
		if (OPEN_LOCAL_CONNECTIONS.others({ name: this.name, connection: this }) > 0) return false
		return this.deleteDatabase()
	}

	/** The database deleted, its connection closed first; what this connection knew of it forgotten. */
	private async deleteDatabase(): Promise<true> {
		if (this.db.isOpen()) {
			this.db.close()
			await tick()
		}
		await Dexie.delete(this.name)
		this.knownDocuments.clear()
		this.recordCounts.clear()
		// its next operation builds the connection again, under the schema lock, on a new database: the store
		// reads empty, as every store does
		this.stale = true
		return true
	}

	/**
	 * This connection counted open: the open lock held shared (seen by every tab), or, with no Web Locks,
	 * counted in the realm. Waits while a destroy holds the lock alone; an open at once shares the hold.
	 */
	private async holdOpen(): Promise<void> {
		this.openHold ??= this.askOpenHold()
		await this.openHold
	}

	/** The open lock asked for shared, its release once granted; with no Web Locks, counted in the realm. */
	private askOpenHold(): Promise<() => void> {
		const name = this.name
		if (!navigator.locks) {
			OPEN_LOCAL_CONNECTIONS.markOpen({ name, connection: this })
			return Promise.resolve(this.countClosed.bind(this))
		}
		let ended: Promise<unknown> = Promise.resolve()
		const granted = new Promise<() => void>(function requestHold(grant) {
			ended = navigator.locks.request(
				`${OPEN_LOCK_PREFIX}${name}`,
				{ mode: 'shared' },
				function holdShared() {
					return new Promise<void>(function holdUntilLetGo(letGo) {
						grant(letGo)
					})
				},
			)
		})
		this.openHoldEnded = ended
		return granted
	}

	/** This connection counted open in the realm no more (where there are no Web Locks). */
	private countClosed(): void {
		OPEN_LOCAL_CONNECTIONS.markClosed({ name: this.name, connection: this })
	}

	/** The hold let go: at once when granted, else once it is (a close while the open waits for it). */
	private letOpenHoldGo(): void {
		const hold = this.openHold
		this.openHold = undefined
		void hold?.then(letHoldGo)
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
		return this.operation(() => this.getDocumentsUnguarded())
	}

	async updateDocument(documentId: string, updates: DocumentUpdates): Promise<void> {
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

	/** The registry first, then the changelog: no index carries the id there, so it is scanned (a rare call). */
	async getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome> {
		return this.operation(async () => {
			const { writeId } = params
			const documents = await this.getDocumentsUnguarded()
			await this.ensureCurrentSchema()
			const committed = await this.db
				.table<ChangeLogEntry>(TABLE_CHANGELOG)
				.filter((entry) => entry.writeId === writeId)
				.first()
			return writeOutcomeOf({ documents, writeId, committed: committed !== undefined })
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
		writeId?: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		return this.operation(async () => {
			try {
				const {
					documentId,
					writeId = crypto.randomUUID(),
					creates,
					updates,
					deletes,
					onProgress,
				} = params
				const table = await this.writeTable(documentId)
				const document = await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).get(documentId)
				if (document && withStatus(document).status === 'importing') {
					throwDocumentNotRegistered({ documentId, what: 'a commit' })
				}
				checkWriteId({ writeId })

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

							// every refusal before anything is written: a create that is not JSON, a taken id,
							// then an update that is not JSON
							const created = toStoredRecords({ records: creates })
							if (created.length > 0) await addRecords({ table, creates: created, documentId })
							const updated = toStoredRecords({ records: updates })

							if (updated.length > 0) {
								try {
									await table.bulkPut(updated)
								} catch (error) {
									throwDialecteError('STORE_BULK_UPDATE_FAILED', {
										detail: error instanceof Error ? error.message : String(error),
										cause: error instanceof Error ? error : undefined,
									})
								}
							}

							// the deleted records as they are at this step: one the commit created or updated is kept so
							const deletedSnapshots = deletes.length > 0 ? await table.bulkGet(deletes) : []
							if (deletes.length > 0) {
								try {
									await table.bulkDelete(deletes)
								} catch (error) {
									throwDialecteError('STORE_DELETE_FAILED', {
										detail: error instanceof Error ? error.message : String(error),
										cause: error instanceof Error ? error : undefined,
									})
								}
							}

							// the undone entries discarded: no sequence, no operations, their ids kept for the outcome
							const head = await this.getHead(documentId)
							await this.db
								.table<ChangeLogEntry>(TABLE_CHANGELOG)
								.where({ documentId })
								.filter((e) => e.sequenceNumber > head)
								.modify(function discard(discarded) {
									discarded.sequenceNumber = DISCARDED_SEQUENCE
									discarded.operations = { creates: [], updates: [], deletes: [] }
								})

							const newSeq = head + 1
							const entry: Omit<ChangeLogEntry, 'id'> = {
								documentId,
								sequenceNumber: newSeq,
								timestamp: Date.now(),
								writeId,
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
					tellCommitProgress({
						onProgress,
						parts: [creates.length, updates.length, deletes.length],
					})
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
					// in reverse: the deleted records back, the records as they were before, the creates gone
					const { creates, updates, deletes } = entry.operations

					if (deletes.length > 0) {
						await table.bulkPut(deletes)
					}
					if (updates.length > 0) {
						await table.bulkPut(updates.map((u) => u.before))
					}
					if (creates.length > 0) {
						await table.bulkDelete(creates.map((r) => r.id))
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
						await table.bulkPut(creates)
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
			const entries = await this.db
				.table<ChangeLogEntry>(TABLE_CHANGELOG)
				.where({ documentId })
				.sortBy('sequenceNumber')
			return entries.filter((entry) => entry.sequenceNumber !== DISCARDED_SEQUENCE)
		})
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		return this.operation(async () => {
			await this.ensureCurrentSchema()
			invariantBlobOwnerKnown(this.knownDocuments, entry.documentId)
			const checked = toJsonCopy({ value: entry })
			const blobTable = this.db.table<{ id: string; data: Blob }>(blobTableName(entry.documentId))
			await this.db.transaction('rw', this.db.table(TABLE_BLOBS), blobTable, async () => {
				await this.db.table<BlobRecord>(TABLE_BLOBS).put(checked)
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
			const checked = toJsonCopy({ value: ref })
			const exists = entry.attachedTo.some(
				(a) =>
					a.documentId === ref.documentId &&
					a.recordRef === ref.recordRef &&
					a.attribute === ref.attribute,
			)
			if (exists) return
			const attachedTo = [...entry.attachedTo, checked]
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
		// one started while this store's own destroy runs goes on once it has ended: it keeps that destroy
		// from nothing
		if (this.destroying) {
			while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
			// closed while it waited: refused before it holds the store open again
			if (this.closed) throwStoreClosed({ storeName: this.name })
		}
		// counted open again after its own destroy (or a destroy racing its open), as a SQLite store
		// connects again on its next operation
		if (this.openHold === undefined) await this.holdOpen()
		// closed while it waited: refused, as one started after the close is
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
	 * The store the open's sweep of unfinished imports goes through: the open is one operation, so a
	 * destroy of this store meanwhile, which waits for it, does not hold the sweep back.
	 */
	private ownSweepTarget(): Pick<Store, 'getDocuments' | 'getDocument' | 'removeDocument'> {
		return {
			getDocuments: () => this.tracked(() => this.getDocumentsUnguarded()),
			getDocument: (documentId) => this.tracked(() => this.getDocumentUnguarded(documentId)),
			removeDocument: (documentId) => this.tracked(() => this.removeDocumentUnguarded(documentId)),
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
			// refused here for an id this connection knows; an id another connection registers meanwhile is
			// refused again in the add's transaction
			if (this.knownDocuments.has(file.id)) throwDocumentAlreadyRegistered({ documentId: file.id })
			const document = toJsonCopy({ value: file })
			// refused before the schema changes; checked again with the add, which no other write interleaves
			await this.assertPlaceFree({ document })
			this.knownDocuments.set(document.id, document)
			await this.reopenWithNewSchema()
			try {
				await this.db.transaction('rw', TABLE_DOCUMENTS, async () => {
					// the id first, as every registration refuses: a place refused below then names no other
					// connection's document of this id
					if (await this.db.table(TABLE_DOCUMENTS).get(document.id)) {
						throwDocumentAlreadyRegistered({ documentId: document.id })
					}
					await this.assertPlaceFree({ document })
					await this.db.table(TABLE_DOCUMENTS).add(document)
				})
			} catch (failure) {
				if (toDialecteError(failure)?.key === 'DOCUMENT_PATH_TAKEN') {
					// a place taken meanwhile, no document of this id registered (checked in the same transaction):
					// the document and the table made for it go again; the refusal is what the caller is told,
					// whatever the drop does
					this.knownDocuments.delete(document.id)
					await this.reopenWithNewSchema({ drop: document.id }).catch(() => undefined)
				} else {
					// any other failure (an id another connection registered meanwhile, refused STORE_DUPLICATE_ID)
					// may name that document's tables: nothing is forgotten or dropped here, the registry is read
					// again at the next operation
					this.stale = true
				}
				throw failure
			}
		})
	}

	/**
	 * The document's path valid and its place free among the registered documents, read in the caller's transaction
	 * when there is one.
	 */
	private async assertPlaceFree(params: { document: DocumentRecord }): Promise<void> {
		const { document } = params
		const documents =
			document.path === undefined
				? []
				: await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).toArray()
		assertDocumentPlace({ document, documents })
	}

	private async getDocumentsUnguarded(): Promise<DocumentRecord[]> {
		await this.ensureCurrentSchema()
		const rows = await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).toArray()
		return rows.map(withStatus)
	}

	private async getDocumentUnguarded(documentId: string): Promise<DocumentRecord | undefined> {
		await this.ensureCurrentSchema()
		const row = await this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS).get(documentId)
		return row && withStatus(row)
	}

	private async updateDocumentUnguarded(
		documentId: string,
		updates: DocumentUpdates,
	): Promise<void> {
		const checked = toJsonCopy({ value: updates })
		await this.ensureCurrentSchema()
		const documents = this.db.table<StoredDocumentRow>(TABLE_DOCUMENTS)
		// read, checked and written in one transaction: no other write of the registry lands in between
		const updated = await this.db.transaction('rw', documents, async () => {
			const held = await documents.get(documentId)
			if (!held) return undefined
			const document = applyDocumentUpdates({ document: withStatus(held), updates: checked })
			if (document.path !== held.path) {
				assertDocumentPlace({ document, documents: await documents.toArray() })
			}
			await documents.put(document)
			return document
		})
		if (updated && this.knownDocuments.has(documentId)) {
			this.knownDocuments.set(documentId, updated)
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
			const creates = toStoredRecords({ records: ops.creates ?? [] })

			await this.db.transaction('rw', table, this.db.table(TABLE_META), async () => {
				if (creates.length > 0) {
					this.perf.start('core::store::bulkWrite::add')
					await addRecords({ table, creates, documentId })
					this.perf.stop('core::store::bulkWrite::add')
				}

				if (updates?.length) {
					this.perf.start('core::store::bulkWrite::update')
					try {
						// the patches that apply are checked as one list, as every store checks them
						const held = await table.bulkGet(updates.map((patch) => patch.recordId))
						const applying = updates.filter((_patch, index) => held[index] !== undefined)
						const checked = toJsonCopy({ value: applying })
						const patched = new Map<string, AnyRawRecord>()
						for (const record of held) if (record) patched.set(record.id, record)
						for (const patch of checked) {
							const record = patched.get(patch.recordId)
							if (record) patched.set(patch.recordId, applyRecordPatch({ record, patch }))
						}
						await table.bulkPut([...patched.values()])
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
