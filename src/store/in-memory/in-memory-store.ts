import { applyRecordPatch } from '../apply-record-patch'
import {
	throwDocumentAlreadyRegistered,
	throwDocumentNotRegistered,
	throwDuplicateRecordIds,
	throwRecordToUpdateNotFound,
} from '../store-errors'
import { recordTableName } from '../store.constants'
import { EMPTY_TABLE } from './in-memory-store.constants'

import { throwDialecteError } from '@/errors'

import type { Store, ChangeLogEntry } from '../store.types'
import type { InMemoryStoreOptions } from './types'
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
 * When writable is false, any mutation throws STORE_NOT_WRITABLE.
 * Reads always return empty results.
 */
export class InMemoryStore implements Store {
	readonly name: string
	private readonly writable: boolean

	/** Guard so the cross-realm no-op warning is emitted at most once per session. */
	private static reconcileWarned = false

	private documents = new Map<string, DocumentRecord>()
	private records = new Map<string, Map<string, AnyRawRecord>>()
	private changelog = new Map<string, ChangeLogEntry[]>()
	private heads = new Map<string, number>()
	private blobs = new Map<string, BlobRecord>()
	private blobData = new Map<string, Map<string, Blob>>()

	constructor(name: string, options?: InMemoryStoreOptions) {
		this.name = name
		this.writable = options?.writable ?? true
	}

	// --- Lifecycle ---

	async open(): Promise<void> {}

	close(): void {}

	async destroy(): Promise<void> {
		this.documents.clear()
		this.records.clear()
		this.changelog.clear()
		this.heads.clear()
		this.blobs.clear()
		this.blobData.clear()
	}

	// --- Cross-realm reconciliation ---

	/**
	 * No-op: in-memory data is not shared across realms/tabs, so there is nothing
	 * to reconcile. Warns once to flag that a cross-realm setup (e.g. iframe
	 * extensions) will not see documents imported in another realm with this store.
	 */
	async reconcile(): Promise<void> {
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
		return this.documents.has(documentId)
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		this.guardWritable()
		if (this.documents.has(file.id)) throwDocumentAlreadyRegistered({ documentId: file.id })
		this.documents.set(file.id, file)
		this.records.set(recordTableName(file.id), new Map())
		this.blobData.set(file.id, new Map())
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.documents.get(documentId)
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return [...this.documents.values()]
	}

	async updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status' | 'importingAt'>>,
	): Promise<void> {
		this.guardWritable()
		const existing = this.documents.get(documentId)
		if (existing) {
			this.documents.set(documentId, { ...existing, ...updates })
		}
	}

	async removeDocument(documentId: string): Promise<void> {
		this.guardWritable()
		this.documents.delete(documentId)
		this.records.delete(recordTableName(documentId))
		this.changelog.delete(documentId)
		this.heads.delete(documentId)
		this.blobData.delete(documentId)
		for (const [blobId, entry] of this.blobs) {
			if (entry.documentId === documentId) {
				this.blobs.delete(blobId)
			}
		}
	}

	// --- Record access ---

	async get(id: string, documentId?: string): Promise<AnyRawRecord | undefined> {
		if (documentId) {
			return this.readTable(documentId).get(id)
		}
		for (const table of this.records.values()) {
			const record = table.get(id)
			if (record) return record
		}
		return undefined
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return [...this.readTable(documentId).values()]
	}

	async count(documentId: string): Promise<number> {
		return this.readTable(documentId).size
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		const results: AnyRawRecord[] = []
		for (const record of this.readTable(documentId).values()) {
			if (record.tagName === tagName) results.push(record)
		}
		return results
	}

	async getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]> {
		const table = this.readTable(documentId)
		return ids.map((id) => table.get(id))
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		this.guardWritable()
		const table = this.writeTable(documentId)

		if (ops.creates) {
			guardNoDuplicate({ table, creates: ops.creates, documentId })
			for (const record of ops.creates) {
				table.set(record.id, record)
			}
		}

		if (ops.updates) {
			for (const patch of ops.updates) {
				const record = table.get(patch.recordId)
				if (!record) continue
				table.set(patch.recordId, applyRecordPatch({ record, patch }))
			}
		}

		if (ops.deletes) {
			for (const id of ops.deletes) {
				table.delete(id)
			}
		}
	}

	async commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		this.guardWritable()
		const { documentId, creates, updates, deletes, onProgress } = params
		const table = this.writeTable(documentId)
		const total = creates.length + updates.length + deletes.length
		let completed = 0

		// Nothing is written before the whole commit is known to apply: updates are checked first,
		// then creates, the order every store answers in
		const beforeSnapshots = updates.map((record) => {
			const before = table.get(record.id)
			if (!before) throwRecordToUpdateNotFound({ documentId, recordId: record.id })
			return before
		})
		guardNoDuplicate({ table, creates, documentId })
		const deletedSnapshots = deletes.map((id) => table.get(id)).filter(Boolean) as AnyRawRecord[]

		for (const record of creates) {
			table.set(record.id, record)
		}
		completed += creates.length
		onProgress(completed, total)

		for (const record of updates) {
			table.set(record.id, record)
		}
		completed += updates.length
		onProgress(completed, total)

		for (const id of deletes) {
			table.delete(id)
		}
		completed += deletes.length
		onProgress(completed, total)

		// Changelog
		const head = this.heads.get(documentId) ?? 0
		const entries = this.changelog.get(documentId) ?? []

		// Trim redoable future
		const trimmed = entries.filter((e) => e.sequenceNumber <= head)

		const newSeq = head + 1
		const entry: ChangeLogEntry = {
			id: trimmed.length + 1,
			documentId,
			sequenceNumber: newSeq,
			timestamp: Date.now(),
			operations: {
				creates,
				updates: updates.map((after, i) => ({ before: beforeSnapshots[i], after })),
				deletes: deletedSnapshots,
			},
		}
		trimmed.push(entry)
		this.changelog.set(documentId, trimmed)
		this.heads.set(documentId, newSeq)
	}

	// --- History ---

	async undo(documentId: string): Promise<void> {
		this.guardWritable()
		const head = this.heads.get(documentId) ?? 0
		if (head === 0) return

		const entries = this.changelog.get(documentId) ?? []
		const entry = entries.find((e) => e.sequenceNumber === head)
		if (!entry) return

		const table = this.writeTable(documentId)
		const { creates, updates, deletes } = entry.operations

		for (const record of creates) {
			table.delete(record.id)
		}
		for (const u of updates) {
			table.set(u.before.id, u.before)
		}
		for (const record of deletes) {
			table.set(record.id, record)
		}

		this.heads.set(documentId, head - 1)
	}

	async redo(documentId: string): Promise<void> {
		this.guardWritable()
		const head = this.heads.get(documentId) ?? 0
		const next = head + 1

		const entries = this.changelog.get(documentId) ?? []
		const entry = entries.find((e) => e.sequenceNumber === next)
		if (!entry) return

		const table = this.writeTable(documentId)
		const { creates, updates, deletes } = entry.operations

		for (const record of creates) {
			table.set(record.id, record)
		}
		for (const u of updates) {
			table.set(u.after.id, u.after)
		}
		for (const record of deletes) {
			table.delete(record.id)
		}

		this.heads.set(documentId, next)
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		const head = this.heads.get(documentId) ?? 0
		const entries = this.changelog.get(documentId) ?? []
		return {
			canUndo: head > 0,
			canRedo: entries.some((entry) => entry.sequenceNumber === head + 1),
		}
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.changelog.get(documentId) ?? []
	}

	getDatabaseInstance(): unknown {
		return null
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		this.guardWritable()
		if (!this.documents.has(entry.documentId)) {
			throwDocumentNotRegistered({ documentId: entry.documentId, what: 'a blob' })
		}
		this.blobs.set(entry.id, entry)
		this.getBlobTable(entry.documentId).set(entry.id, data)
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		const entry = this.blobs.get(blobId)
		if (!entry) return undefined
		const data = this.getBlobTable(entry.documentId).get(blobId)
		if (!data) return undefined
		return { entry, data }
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return [...this.blobs.values()].filter((b) =>
			b.attachedTo.some((a) => a.documentId === documentId),
		)
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return [...this.blobs.values()].filter((b) =>
			b.attachedTo.some((a) => a.documentId === documentId && a.recordRef === recordRef),
		)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return [...this.blobs.values()].filter((b) => b.attachedTo.length === 0)
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		this.guardWritable()
		const entry = this.blobs.get(blobId)
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
		this.blobs.set(blobId, { ...entry, attachedTo: [...entry.attachedTo, ref] })
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		this.guardWritable()
		const entry = this.blobs.get(blobId)
		if (!entry) {
			throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		}
		const attachedTo = entry.attachedTo.filter(
			(a) => !(a.documentId === ref.documentId && a.recordRef === ref.recordRef),
		)
		this.blobs.set(blobId, { ...entry, attachedTo })
	}

	async removeBlob(blobId: string): Promise<void> {
		this.guardWritable()
		const entry = this.blobs.get(blobId)
		if (!entry) return
		this.blobs.delete(blobId)
		this.getBlobTable(entry.documentId).delete(blobId)
	}

	// --- Private ---

	private getBlobTable(documentId: string): Map<string, Blob> {
		let table = this.blobData.get(documentId)
		if (!table) {
			table = new Map()
			this.blobData.set(documentId, table)
		}
		return table
	}

	/** The records of a document; a document that is not in the store reads empty. */
	private readTable(documentId: string): ReadonlyMap<string, AnyRawRecord> {
		return this.records.get(recordTableName(documentId)) ?? EMPTY_TABLE
	}

	/** The records of a document to write; a document that is not registered takes no write. */
	private writeTable(documentId: string): Map<string, AnyRawRecord> {
		const table = this.records.get(recordTableName(documentId))
		if (!table) throwDocumentNotRegistered({ documentId, what: 'records' })
		return table
	}

	private guardWritable(): void {
		if (!this.writable) {
			throwDialecteError('STORE_NOT_WRITABLE', {
				detail: 'In-memory store is read-only. Hydrate with a real document before writing.',
			})
		}
	}
}
