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

import Dexie from 'dexie'

import { throwDialecteError } from '@/errors'

import type { Store, ChangeLogEntry, ChangeLogMeta, RecordSchema } from '../store.types'
import type { DexieStoreOptions } from './types'
import type { DocumentRecord } from '@/project'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

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
	/** In-memory file registry - avoids bootstrap connections during close/reopen */
	private knownDocuments: Map<string, DocumentRecord> = new Map()
	/** Serialization lock for schema-changing operations */
	private schemaLock: Promise<void> = Promise.resolve()

	constructor(projectName: string, options?: DexieStoreOptions) {
		this.name = projectName
		this.dexieRecordSchema = buildDexieSchema(options?.recordSchema ?? DEFAULT_RECORD_SCHEMA)
		this.db = new Dexie(projectName)
	}

	// --- Lifecycle ---

	async open(): Promise<void> {
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
			const files: DocumentRecord[] = await bootstrap.table(TABLE_DOCUMENTS).toArray()
			const meta = await bootstrap.table(TABLE_META).get('schemaVersion')
			bootstrap.close()

			// Populate in-memory registry
			for (const f of files) {
				this.knownDocuments.set(f.id, f)
			}
			this.schemaVersion = meta?.value ?? 1
		} catch {
			// Fresh DB - no existing data
			bootstrap.close()
		}

		// Open with full schema (all known file tables)
		this.db = new Dexie(this.name)
		this.db.version(this.schemaVersion).stores(this.buildStores())
		await this.db.open()
	}

	close(): void {
		this.db.close()
	}

	async destroy(): Promise<void> {
		if (this.db.isOpen()) {
			this.db.close()
			await tick()
		}
		await Dexie.delete(this.name)
		this.knownDocuments.clear()
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		await this.withSchemaLock(async () => {
			this.knownDocuments.set(file.id, file)
			await this.reopenWithNewSchema()
			await this.db.table(TABLE_DOCUMENTS).add(file)
		})
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.db.table<DocumentRecord>(TABLE_DOCUMENTS).get(documentId)
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.db.table<DocumentRecord>(TABLE_DOCUMENTS).toArray()
	}

	async updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata'>>,
	): Promise<void> {
		await this.db.table(TABLE_DOCUMENTS).update(documentId, updates)
		const existing = this.knownDocuments.get(documentId)
		if (existing) {
			this.knownDocuments.set(documentId, { ...existing, ...updates })
		}
	}

	async removeDocument(documentId: string): Promise<void> {
		await this.withSchemaLock(async () => {
			// Clear records first (O(1) table clear)
			const tableName = this.resolveTableName(documentId)
			if (this.db.tables.some((t) => t.name === tableName)) {
				await this.db.table(tableName).clear()
			}

			// Clear blob data table owned by this document
			const blobTable = blobTableName(documentId)
			if (this.db.tables.some((t) => t.name === blobTable)) {
				await this.db.table(blobTable).clear()
			}

			// Remove blob registry entries owned by this document
			await this.db.table<BlobRecord>(TABLE_BLOBS).where({ documentId }).delete()

			// Remove changelog entries for this file
			await this.db.table<ChangeLogEntry>(TABLE_CHANGELOG).where({ documentId }).delete()

			// Remove head
			await this.db.table(TABLE_META).delete(`head:${documentId}`)

			// Remove from _files
			await this.db.table(TABLE_DOCUMENTS).delete(documentId)

			// Remove from memory and reopen (null table = Dexie drop)
			this.knownDocuments.delete(documentId)
			await this.reopenWithNewSchema({ drop: documentId })
		})
	}

	// --- Record access ---

	async get(id: string, documentId?: string): Promise<AnyRawRecord | undefined> {
		if (documentId) {
			return this.db.table<AnyRawRecord>(this.resolveTableName(documentId)).get(id)
		}
		// Cross-file lookup: search all xel_ tables
		for (const fId of this.knownDocuments.keys()) {
			const record = await this.db.table<AnyRawRecord>(this.resolveTableName(fId)).get(id)
			if (record) return record
		}
		return undefined
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return this.db.table<AnyRawRecord>(this.resolveTableName(documentId)).toArray()
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		return this.db
			.table<AnyRawRecord>(this.resolveTableName(documentId))
			.where({ tagName })
			.toArray()
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		const { creates, updates, deletes } = ops
		const table = this.db.table<AnyRawRecord>(this.resolveTableName(documentId))

		await this.db.transaction('rw', table, async () => {
			if (creates?.length) {
				await table.bulkAdd(creates)
			}

			if (updates?.length) {
				for (const { recordId, ...patch } of updates) {
					const record = await table.get(recordId)
					if (!record) continue

					const merged: Partial<Omit<AnyRawRecord, 'id'>> = { ...patch }

					if (patch.attributes) {
						const updatedAttributes = [...record.attributes]
						for (const attr of patch.attributes) {
							const idx = updatedAttributes.findIndex((a) => a.name === attr.name)
							if (idx >= 0) updatedAttributes[idx] = attr
							else updatedAttributes.push(attr)
						}
						merged.attributes = updatedAttributes
					}

					if (patch.children) {
						const updatedChildren = [...record.children]
						for (const child of patch.children) {
							const idx = updatedChildren.findIndex((c) => c.id === child.id)
							if (idx >= 0) updatedChildren[idx] = child
							else updatedChildren.push(child)
						}
						merged.children = updatedChildren
					}

					await table.update(recordId, merged)
				}
			}

			if (deletes?.length) {
				await table.bulkDelete(deletes)
			}
		})
	}

	async commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		const { documentId, creates, updates, deletes, onProgress } = params
		const table = this.db.table<AnyRawRecord>(this.resolveTableName(documentId))
		const total = creates.length + updates.length + deletes.length
		let completed = 0

		try {
			await this.db.transaction(
				'rw',
				table,
				this.db.table(TABLE_CHANGELOG),
				this.db.table(TABLE_META),
				async () => {
					// Snapshot before-state for undo
					const beforeSnapshots: (AnyRawRecord | undefined)[] =
						updates.length > 0 ? await table.bulkGet(updates.map((r) => r.id)) : []
					const deletedSnapshots: (AnyRawRecord | undefined)[] =
						deletes.length > 0 ? await table.bulkGet(deletes) : []

					if (creates.length > 0) {
						try {
							await table.bulkAdd(creates)
							completed += creates.length
							onProgress(completed, total)
						} catch (error) {
							throwDialecteError('STORE_BULK_ADD_FAILED', {
								detail: error instanceof Error ? error.message : String(error),
								cause: error instanceof Error ? error : undefined,
							})
						}
					}

					if (updates.length > 0) {
						try {
							await table.bulkPut(updates)
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
							creates,
							updates: updates.map((after, i) => ({
								before: beforeSnapshots[i]!,
								after,
							})),
							deletes: deletedSnapshots.filter(Boolean) as AnyRawRecord[],
						},
					}
					await this.db.table(TABLE_CHANGELOG).add(entry)
					await this.setHead(documentId, newSeq)
				},
			)
		} catch (error) {
			if (error instanceof Error && error.message.includes('dialecte')) {
				throw error
			}
			throwDialecteError('STORE_COMMIT_FAILED', {
				detail: error instanceof Error ? error.message : String(error),
				cause: error instanceof Error ? error : undefined,
			})
		}
	}

	// --- History ---

	async undo(documentId: string): Promise<void> {
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
		})
	}

	async redo(documentId: string): Promise<void> {
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
		})
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.db
			.table<ChangeLogEntry>(TABLE_CHANGELOG)
			.where({ documentId })
			.sortBy('sequenceNumber')
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		invariantBlobOwnerKnown(this.knownDocuments, entry.documentId)
		const blobTable = this.db.table<{ id: string; data: Blob }>(blobTableName(entry.documentId))
		await this.db.transaction('rw', this.db.table(TABLE_BLOBS), blobTable, async () => {
			await this.db.table<BlobRecord>(TABLE_BLOBS).put(entry)
			await blobTable.put({ id: entry.id, data })
		})
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
		if (!entry) return undefined
		const row = await this.db
			.table<{ id: string; data: Blob }>(blobTableName(entry.documentId))
			.get(blobId)
		if (!row) return undefined
		return { entry, data: row.data }
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
		return all.filter((b) => b.attachedTo.some((a) => a.documentId === documentId))
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
		return all.filter((b) =>
			b.attachedTo.some((a) => a.documentId === documentId && a.recordRef === recordRef),
		)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		const all = await this.db.table<BlobRecord>(TABLE_BLOBS).toArray()
		return all.filter((b) => b.attachedTo.length === 0)
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
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
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
		if (!entry) {
			throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		}
		const attachedTo = entry.attachedTo.filter(
			(a) => !(a.documentId === ref.documentId && a.recordRef === ref.recordRef),
		)
		await this.db.table<BlobRecord>(TABLE_BLOBS).update(blobId, { attachedTo })
	}

	async removeBlob(blobId: string): Promise<void> {
		const entry = await this.db.table<BlobRecord>(TABLE_BLOBS).get(blobId)
		if (!entry) return
		const blobTable = this.db.table<{ id: string }>(blobTableName(entry.documentId))
		await this.db.transaction('rw', this.db.table(TABLE_BLOBS), blobTable, async () => {
			await blobTable.delete(blobId)
			await this.db.table(TABLE_BLOBS).delete(blobId)
		})
	}

	/**
	 * Expose the underlying Dexie instance.
	 * Useful for legacy compatibility layers and advanced testing.
	 */
	getDatabaseInstance(): Dexie {
		return this.db
	}

	// --- Private helpers ---

	private async getHead(documentId: string): Promise<number> {
		const meta = await this.db.table<ChangeLogMeta>(TABLE_META).get(`head:${documentId}`)
		return meta?.value ?? 0
	}

	private async setHead(documentId: string, value: number): Promise<void> {
		await this.db.table<ChangeLogMeta>(TABLE_META).put({ key: `head:${documentId}`, value })
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
		this.db.close()
		await tick()
		this.schemaVersion++
		this.db = new Dexie(this.name)
		this.db.version(this.schemaVersion).stores(this.buildStores(options))
		await this.db.open()
		// Persist schema version
		await this.db.table(TABLE_META).put({ key: 'schemaVersion', value: this.schemaVersion })
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
}

/** Yield one microtask to let IndexedDB release connections */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

function invariantBlobOwnerKnown(known: Map<string, DocumentRecord>, documentId: string): void {
	if (!known.has(documentId)) {
		throwDialecteError('DOCUMENT_NOT_REGISTERED', {
			detail: `Cannot add blob: owner document "${documentId}" is not registered`,
		})
	}
}
