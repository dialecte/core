import { applyRecordPatch } from '../apply-record-patch'
import { tellCommitProgress } from '../commit-progress'
import { compareById } from '../compare-by-id'
import { toJsonCopy } from '../json-values'
import { createRunningOperations } from '../running-operations'
import {
	throwDocumentAlreadyRegistered,
	throwDocumentNotRegistered,
	throwDuplicateRecordIds,
	throwRecordToUpdateNotFound,
	throwStoreClosed,
} from '../store-errors'
import { recordTableName } from '../store.constants'
import { toStoredRecords } from '../stored-record'
import { removeUnfinishedImports } from '../unfinished-imports'
import { writeOutcomeOf } from '../write-outcome'
import {
	bumpVersion,
	dropInMemoryState,
	ensureInMemoryState,
	findInMemoryState,
} from './in-memory-state'
import { EMPTY_STATE, EMPTY_TABLE } from './in-memory-store.constants'

import { throwDialecteError } from '@/errors'
import { runExport } from '@/project/io/run-export'
import { runImport } from '@/project/io/run-import'
import { requireStoreRuntime } from '@/project/io/store-runtime'

import type {
	Store,
	ChangeLogEntry,
	ExportFileParams,
	ExportFileResult,
	ExportSource,
	ImportFileParams,
	ImportFileResult,
	ImportTarget,
	WriteOutcome,
} from '../store.types'
import type { InMemoryState, InMemoryStoreOptions, ReadonlyInMemoryState } from './types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

/**
 * A create whose id the document holds, or that the batch holds twice, is refused before anything
 * is written.
 */
function guardNoDuplicate(params: {
	table: ReadonlyMap<string, AnyRawRecord>
	creates: AnyRawRecord[]
	documentId: string
}): void {
	const { table, creates, documentId } = params
	const seen = new Set<string>()
	const held: string[] = []
	const repeated: string[] = []
	for (const { id } of creates) {
		if (table.has(id)) held.push(id)
		if (seen.has(id)) repeated.push(id)
		seen.add(id)
	}
	if (held.length > 0 || repeated.length > 0) {
		throwDuplicateRecordIds({ documentId, held, repeated })
	}
}

/**
 * InMemoryStore - Map-backed Store implementation with no persistence.
 *
 * Use cases:
 * - Null-object document placeholder (writable: false)
 * - Test fixtures (writable: true)
 * - Demos and playground (writable: true)
 *
 * Every instance of a name reads and writes one state, as every connection to an IndexedDB database
 * of a name does: a store closed and built again under its name finds what was written. `close` keeps
 * it; `destroy` drops it. The state is the realm's (and the loaded copy of core's): nothing crosses
 * realms.
 *
 * Records are values: the store copies what it is handed and what it hands out, so a caller changing
 * its objects never changes the store, as with a store whose records cross a serialisation. Blob data
 * is immutable and is not copied. List reads answer in id order, as an IndexedDB key range does.
 *
 * When writable is false, the store is a placeholder: any mutation throws STORE_NOT_WRITABLE, reads
 * answer empty, and it never reads, keeps or drops the state of its name.
 *
 * Its imports run in its own realm, the page's: `importFile` runs `runImport` with the import
 * runtime it was built with.
 */
export class InMemoryStore implements Store {
	readonly name: string
	private readonly writable: boolean
	private readonly runtime?: StoreRuntime

	/** Guard so the cross-realm no-op warning is emitted at most once per session. */
	private static reconcileWarned = false

	/** Set by `close()`, cleared by `open()`: a closed store refuses every operation started after it. */
	private closed = false
	/** How many times `close()` was called: an `open()` refuses when one came after it was called. */
	private closings = 0
	/** The imports this instance runs (its only operations that span awaits): `open()` and `destroy()` wait for them. */
	private readonly operations = createRunningOperations()

	constructor(name: string, options?: InMemoryStoreOptions) {
		this.name = name
		this.writable = options?.writable ?? true
		this.runtime = options?.runtime
	}

	// --- Lifecycle ---

	/** Open: an import found unfinished - it never outlives the store - is removed; one it runs stays. */
	async open(): Promise<void> {
		const closingsAtCall = this.closings
		// an import still running completes first
		await this.operations.whenIdle()
		// a close() called after this open() wins: the store stays closed
		if (this.closings !== closingsAtCall) throwStoreClosed({ storeName: this.name })
		this.closed = false
		await removeUnfinishedImports({
			store: this,
			isRunning: (document) =>
				document.writeId !== undefined && this.readState().runningImports.has(document.writeId),
		})
	}

	/**
	 * Refuse every operation started from now on until opened again; one running completes (only an
	 * import spans more than a call). The state of the name stays.
	 */
	close(): void {
		this.closed = true
		this.closings += 1
	}

	/** Drop the state of the name, for every instance of it; a placeholder has none to drop. */
	async destroy(): Promise<void> {
		if (!this.writable) return
		// an import still running completes before the state goes
		await this.operations.whenIdle()
		dropInMemoryState({ name: this.name })
	}

	// --- Cross-realm reconciliation ---

	/**
	 * No-op: in-memory data is the realm's (one state per name there), not shared across realms/tabs, so
	 * there is nothing to reconcile. Warns once to flag that a cross-realm setup (e.g. iframe
	 * extensions) will not see documents imported in another realm with this store.
	 */
	async reconcile(): Promise<void> {
		this.guardOpen()
		if (!InMemoryStore.reconcileWarned) {
			InMemoryStore.reconcileWarned = true
			console.warn(
				'[dialecte] InMemoryStore.reconcile() is a no-op: in-memory documents are not ' +
					'shared across realms/tabs. Use the local (IndexedDB) store for cross-realm sync.',
			)
		}
	}

	/** Readiness reduces to liveness for in-memory: readable iff registered. */
	async isDocumentReadable(documentId: string): Promise<boolean> {
		this.guardOpen()
		return this.readState().documents.has(documentId)
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		this.guardOpen()
		return this.registerDocumentUnguarded(file)
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		this.guardOpen()
		return this.getDocumentUnguarded(documentId)
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		this.guardOpen()
		return structuredClone([...this.readState().documents.values()].sort(compareById))
	}

	async updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>,
	): Promise<void> {
		this.guardOpen()
		return this.updateDocumentUnguarded(documentId, updates)
	}

	async removeDocument(documentId: string): Promise<void> {
		this.guardOpen()
		return this.removeDocumentUnguarded(documentId)
	}

	// --- Record access ---

	async get(id: string, documentId: string): Promise<AnyRawRecord | undefined> {
		this.guardOpen()
		return structuredClone(this.readTable(documentId).get(id))
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		this.guardOpen()
		return structuredClone([...this.readTable(documentId).values()].sort(compareById))
	}

	async count(documentId: string): Promise<number> {
		this.guardOpen()
		return this.countUnguarded(documentId)
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		this.guardOpen()
		return this.getByTagNameInDocumentUnguarded(tagName, documentId)
	}

	async getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]> {
		this.guardOpen()
		return this.getManyUnguarded(ids, documentId)
	}

	// --- Import ---

	async importFile(params: ImportFileParams): Promise<ImportFileResult> {
		this.guardOpen()
		this.guardWritable()
		const { file, options, writeId = crypto.randomUUID(), onProgress, signal } = params
		const runtime = requireStoreRuntime({
			runtime: this.runtime,
			storeName: this.name,
			operation: 'import',
		})
		const { runningImports } = ensureInMemoryState({ name: this.name })
		runningImports.add(writeId)
		this.operations.start()
		try {
			return await runImport(
				{ store: this.ownImportTarget(), runtime, file, options, writeId },
				{ onProgress, signal },
			)
		} finally {
			runningImports.delete(writeId)
			this.operations.end()
		}
	}

	// --- Export ---

	async exportFile(params: ExportFileParams): Promise<ExportFileResult> {
		this.guardOpen()
		const { documentId, options, onProgress, signal } = params
		const runtime = requireStoreRuntime({
			runtime: this.runtime,
			storeName: this.name,
			operation: 'export',
		})
		this.operations.start()
		try {
			return await runExport(
				{ source: this.ownExportSource(), runtime, documentId, options },
				{ onProgress, signal },
			)
		} finally {
			this.operations.end()
		}
	}

	async getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome> {
		this.guardOpen()
		const { writeId } = params
		const { documents, changelog, discardedCommits } = this.readState()
		const committed =
			[...changelog.values()].some((entries) =>
				entries.some((entry) => entry.writeId === writeId),
			) || [...discardedCommits.values()].some((discarded) => discarded.has(writeId))
		return writeOutcomeOf({ documents: [...documents.values()], writeId, committed })
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		this.guardOpen()
		return this.bulkWriteUnguarded(documentId, ops)
	}

	async commit(params: {
		documentId: string
		writeId?: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const { documentId, writeId = crypto.randomUUID(), deletes, onProgress } = params
		const { state, table } = this.writeTarget(documentId)
		if (state.documents.get(documentId)?.status === 'importing') {
			throwDocumentNotRegistered({ documentId, what: 'a commit' })
		}

		// Nothing is written before the whole commit is known to apply, refused in the order every
		// store answers in: an absent update, a create that is not JSON, a taken id, then an update
		// that is not JSON. The store's own copies: the table and the changelog hold them, never the
		// caller's objects
		const beforeSnapshots = params.updates.map((record) => {
			const before = table.get(record.id)
			if (!before) throwRecordToUpdateNotFound({ documentId, recordId: record.id })
			return before
		})
		const creates = toStoredRecords({ records: params.creates })
		guardNoDuplicate({ table, creates, documentId })
		const updates = toStoredRecords({ records: params.updates })

		bumpVersion({ state, documentId })
		for (const record of creates) table.set(record.id, record)
		for (const record of updates) table.set(record.id, record)
		// the deleted records as they are at this step: one the commit created or updated is kept so
		const deletedSnapshots = deletes.flatMap((id) => {
			const record = table.get(id)
			return record ? [record] : []
		})
		for (const id of deletes) table.delete(id)

		// Changelog, in the state the records went to; the undone entries are discarded, their ids kept
		const { heads, changelog, discardedCommits } = state
		const head = heads.get(documentId) ?? 0
		const entries = changelog.get(documentId) ?? []
		const trimmed = entries.filter((entry) => entry.sequenceNumber <= head)
		const discarded = discardedCommits.get(documentId) ?? new Set<string>()
		for (const entry of entries) {
			if (entry.sequenceNumber > head) discarded.add(entry.writeId)
		}
		discardedCommits.set(documentId, discarded)

		const newSeq = head + 1
		const entry: ChangeLogEntry = {
			id: trimmed.length + 1,
			documentId,
			sequenceNumber: newSeq,
			timestamp: Date.now(),
			writeId,
			operations: {
				creates,
				updates: updates.map((after, i) => ({ before: beforeSnapshots[i], after })),
				deletes: deletedSnapshots,
			},
		}
		trimmed.push(entry)
		changelog.set(documentId, trimmed)
		heads.set(documentId, newSeq)
		tellCommitProgress({
			onProgress,
			parts: [creates.length, updates.length, deletes.length],
		})
	}

	// --- History ---

	/** Undo the last applied entry, its parts in reverse: the deleted records back, the befores, the creates gone. */
	async undo(documentId: string): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		const head = state?.heads.get(documentId) ?? 0
		if (!state || head === 0) return

		const entries = state.changelog.get(documentId) ?? []
		const entry = entries.find((e) => e.sequenceNumber === head)
		if (!entry) return

		const { table } = this.writeTarget(documentId)
		const { creates, updates, deletes } = entry.operations

		for (const record of deletes) table.set(record.id, record)
		for (const u of updates) table.set(u.before.id, u.before)
		for (const record of creates) table.delete(record.id)

		state.heads.set(documentId, head - 1)
		bumpVersion({ state, documentId })
	}

	async redo(documentId: string): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		if (!state) return
		const head = state.heads.get(documentId) ?? 0
		const next = head + 1

		const entries = state.changelog.get(documentId) ?? []
		const entry = entries.find((e) => e.sequenceNumber === next)
		if (!entry) return

		const { table } = this.writeTarget(documentId)
		const { creates, updates, deletes } = entry.operations

		for (const record of creates) table.set(record.id, record)
		for (const u of updates) table.set(u.after.id, u.after)
		for (const record of deletes) table.delete(record.id)

		state.heads.set(documentId, next)
		bumpVersion({ state, documentId })
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		this.guardOpen()
		const { heads, changelog } = this.readState()
		const head = heads.get(documentId) ?? 0
		const entries = changelog.get(documentId) ?? []
		return {
			canUndo: head > 0,
			canRedo: entries.some((entry) => entry.sequenceNumber === head + 1),
		}
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		this.guardOpen()
		return structuredClone([...(this.readState().changelog.get(documentId) ?? [])])
	}

	getDatabaseInstance(): unknown {
		return null
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		if (!state?.documents.has(entry.documentId)) {
			throwDocumentNotRegistered({ documentId: entry.documentId, what: 'a blob' })
		}
		state.blobs.set(entry.id, toJsonCopy({ value: entry }))
		const blobData = state.blobData.get(entry.documentId) ?? new Map<string, Blob>()
		state.blobData.set(entry.documentId, blobData.set(entry.id, data))
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		this.guardOpen()
		const { blobs, blobData } = this.readState()
		const entry = blobs.get(blobId)
		if (!entry) return undefined
		const data = blobData.get(entry.documentId)?.get(blobId)
		if (!data) return undefined
		return { entry: structuredClone(entry), data }
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		this.guardOpen()
		return structuredClone(
			[...this.readState().blobs.values()]
				.filter((b) => b.attachedTo.some((a) => a.documentId === documentId))
				.sort(compareById),
		)
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		this.guardOpen()
		return structuredClone(
			[...this.readState().blobs.values()]
				.filter((b) =>
					b.attachedTo.some((a) => a.documentId === documentId && a.recordRef === recordRef),
				)
				.sort(compareById),
		)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		this.guardOpen()
		return structuredClone(
			[...this.readState().blobs.values()]
				.filter((b) => b.attachedTo.length === 0)
				.sort(compareById),
		)
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		const entry = state?.blobs.get(blobId)
		if (!state || !entry) {
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
		state.blobs.set(blobId, {
			...entry,
			attachedTo: [...entry.attachedTo, checked],
		})
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		const entry = state?.blobs.get(blobId)
		if (!state || !entry) {
			throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		}
		const attachedTo = entry.attachedTo.filter(
			(a) => !(a.documentId === ref.documentId && a.recordRef === ref.recordRef),
		)
		state.blobs.set(blobId, { ...entry, attachedTo })
	}

	async removeBlob(blobId: string): Promise<void> {
		this.guardOpen()
		this.guardWritable()
		const state = this.writeState()
		const entry = state?.blobs.get(blobId)
		if (!state || !entry) return
		state.blobs.delete(blobId)
		state.blobData.get(entry.documentId)?.delete(blobId)
	}

	private async registerDocumentUnguarded(file: DocumentRecord): Promise<void> {
		this.guardWritable()
		const state = ensureInMemoryState({ name: this.name })
		if (state.documents.has(file.id)) throwDocumentAlreadyRegistered({ documentId: file.id })
		state.documents.set(file.id, toJsonCopy({ value: file }))
		state.records.set(recordTableName(file.id), new Map())
		state.blobData.set(file.id, new Map())
	}

	private async getDocumentUnguarded(documentId: string): Promise<DocumentRecord | undefined> {
		return structuredClone(this.readState().documents.get(documentId))
	}

	private async updateDocumentUnguarded(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>,
	): Promise<void> {
		this.guardWritable()
		const checked = toJsonCopy({ value: updates })
		const state = this.writeState()
		const existing = state?.documents.get(documentId)
		if (state && existing) {
			state.documents.set(documentId, { ...existing, ...checked })
		}
	}

	private async removeDocumentUnguarded(documentId: string): Promise<void> {
		this.guardWritable()
		const state = this.writeState()
		if (!state) return
		state.documents.delete(documentId)
		state.records.delete(recordTableName(documentId))
		state.changelog.delete(documentId)
		state.heads.delete(documentId)
		state.discardedCommits.delete(documentId)
		// the version stays: a document registered again under the id goes on from it, never back to a past value
		state.blobData.delete(documentId)
		for (const [blobId, entry] of state.blobs) {
			if (entry.documentId === documentId) {
				state.blobs.delete(blobId)
			}
		}
	}

	private async bulkWriteUnguarded(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		this.guardWritable()
		const { state, table } = this.writeTarget(documentId)
		// Nothing is written before the whole write is known to apply, refused in the order every
		// store answers in: a create that is not JSON, a taken id, then an update that is not JSON - of
		// the updates that apply: a patch of a record the document does not hold is skipped, as ever
		const creates = toStoredRecords({ records: ops.creates ?? [] })
		guardNoDuplicate({ table, creates, documentId })
		const createdIds = new Set(creates.map((record) => record.id))
		const updates = toJsonCopy({
			value: (ops.updates ?? []).filter(
				(patch) => table.has(patch.recordId) || createdIds.has(patch.recordId),
			),
		})

		for (const record of creates) {
			table.set(record.id, record)
		}

		for (const patch of updates) {
			const record = table.get(patch.recordId)
			if (!record) continue
			table.set(patch.recordId, applyRecordPatch({ record, patch }))
		}

		if (ops.deletes) {
			for (const id of ops.deletes) {
				table.delete(id)
			}
		}
		bumpVersion({ state, documentId })
	}

	// --- Private ---

	/**
	 * The state of the name to read, resolved on every operation: empty when it has none, and always
	 * for a placeholder. Read-only: a write goes through `writeState`.
	 */
	private readState(): ReadonlyInMemoryState {
		if (!this.writable) return EMPTY_STATE
		return findInMemoryState({ name: this.name }) ?? EMPTY_STATE
	}

	/** The state of the name to write, resolved on every operation; none when nothing is held under it. */
	private writeState(): InMemoryState | undefined {
		return findInMemoryState({ name: this.name })
	}

	/** The records of a document; a document that is not in the store reads empty. */
	private readTable(documentId: string): ReadonlyMap<string, AnyRawRecord> {
		return this.readState().records.get(recordTableName(documentId)) ?? EMPTY_TABLE
	}

	/**
	 * The state and the records of a document to write, both of one resolution; a document that is not
	 * registered takes no write.
	 */
	private writeTarget(documentId: string): {
		state: InMemoryState
		table: Map<string, AnyRawRecord>
	} {
		const state = this.writeState()
		const table = state?.records.get(recordTableName(documentId))
		if (!state || !table) throwDocumentNotRegistered({ documentId, what: 'records' })
		return { state, table }
	}

	private guardOpen(): void {
		if (this.closed) throwStoreClosed({ storeName: this.name })
	}

	/**
	 * The target the store's own import writes through: the import is one operation, so a `close()`
	 * after it started does not refuse the calls it makes.
	 */
	private ownImportTarget(): ImportTarget {
		return {
			registerDocument: (file) => this.registerDocumentUnguarded(file),
			getDocument: (documentId) => this.getDocumentUnguarded(documentId),
			updateDocument: (documentId, updates) => this.updateDocumentUnguarded(documentId, updates),
			removeDocument: (documentId) => this.removeDocumentUnguarded(documentId),
			bulkWrite: (documentId, ops) => this.bulkWriteUnguarded(documentId, ops),
		}
	}

	/**
	 * The source the store's own export reads through: the export is one operation, so a `close()` after it
	 * started does not refuse the calls it makes.
	 */
	private ownExportSource(): ExportSource {
		return {
			getDocument: (documentId) => this.getDocumentUnguarded(documentId),
			count: (documentId) => this.countUnguarded(documentId),
			getByTagNameInDocument: (tagName, documentId) =>
				this.getByTagNameInDocumentUnguarded(tagName, documentId),
			getMany: (ids, documentId) => this.getManyUnguarded(ids, documentId),
			getExportVersion: (params) => this.getExportVersion(params),
		}
	}

	/** How many writes a `ready` document has taken; `undefined` for one not registered or not ready. */
	private async getExportVersion(params: { documentId: string }): Promise<number | undefined> {
		const { documentId } = params
		const { documents, versions } = this.readState()
		if (documents.get(documentId)?.status !== 'ready') return undefined
		return versions.get(documentId) ?? 0
	}

	private async countUnguarded(documentId: string): Promise<number> {
		return this.readTable(documentId).size
	}

	private async getByTagNameInDocumentUnguarded(
		tagName: string,
		documentId: string,
	): Promise<AnyRawRecord[]> {
		const results: AnyRawRecord[] = []
		for (const record of this.readTable(documentId).values()) {
			if (record.tagName === tagName) results.push(record)
		}
		return structuredClone(results.sort(compareById))
	}

	private async getManyUnguarded(
		ids: string[],
		documentId: string,
	): Promise<(AnyRawRecord | undefined)[]> {
		const table = this.readTable(documentId)
		return structuredClone(ids.map((id) => table.get(id)))
	}

	private guardWritable(): void {
		if (!this.writable) {
			throwDialecteError('STORE_NOT_WRITABLE', {
				detail: 'In-memory store is read-only. Hydrate with a real document before writing.',
			})
		}
	}
}
