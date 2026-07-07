import { recordTableName } from '../store.constants'

import { throwDialecteError } from '@/errors'

import type { Store, ChangeLogEntry } from '../store.types'
import type { InMemoryStoreOptions } from './types'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

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

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		this.guardWritable()
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
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata'>>,
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
			return this.getTable(documentId).get(id)
		}
		for (const table of this.records.values()) {
			const record = table.get(id)
			if (record) return record
		}
		return undefined
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return [...this.getTable(documentId).values()]
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		const results: AnyRawRecord[] = []
		for (const record of this.getTable(documentId).values()) {
			if (record.tagName === tagName) results.push(record)
		}
		return results
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		this.guardWritable()
		const table = this.getTable(documentId)

		if (ops.creates) {
			for (const record of ops.creates) {
				table.set(record.id, record)
			}
		}

		if (ops.updates) {
			for (const { recordId, ...patch } of ops.updates) {
				const existing = table.get(recordId)
				if (!existing) continue

				const merged = { ...existing }

				if (patch.attributes) {
					const updatedAttributes = [...existing.attributes]
					for (const attr of patch.attributes) {
						const idx = updatedAttributes.findIndex((a) => a.name === attr.name)
						if (idx >= 0) updatedAttributes[idx] = attr
						else updatedAttributes.push(attr)
					}
					merged.attributes = updatedAttributes
				}

				if (patch.children) {
					const updatedChildren = [...existing.children]
					for (const child of patch.children) {
						const idx = updatedChildren.findIndex((c) => c.id === child.id)
						if (idx >= 0) updatedChildren[idx] = child
						else updatedChildren.push(child)
					}
					merged.children = updatedChildren
				}

				table.set(recordId, merged as AnyRawRecord)
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
		const table = this.getTable(documentId)
		const total = creates.length + updates.length + deletes.length
		let completed = 0

		// Snapshot before-state for undo
		const beforeSnapshots = updates.map((r) => table.get(r.id))
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
				updates: updates.map((after, i) => ({
					before: beforeSnapshots[i]!,
					after,
				})),
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

		const table = this.getTable(documentId)
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

		const table = this.getTable(documentId)
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
			throwDialecteError('DOCUMENT_NOT_REGISTERED', {
				detail: `Cannot add blob: owner document "${entry.documentId}" is not registered`,
			})
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

	private getTable(documentId: string): Map<string, AnyRawRecord> {
		const tableName = recordTableName(documentId)
		let table = this.records.get(tableName)
		if (!table) {
			table = new Map()
			this.records.set(tableName, table)
		}
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
