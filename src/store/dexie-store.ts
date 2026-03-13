import Dexie from 'dexie'

import { throwDialecteError } from '@/errors'

import type { Store, ChangeLogEntry, ChangeLogMeta } from './store.types'
import type { AnyDialecteConfig } from '@/types/dialecte-config'
import type { AnyRawRecord } from '@/types/records'

const CHANGELOG_TABLE = '_changeLog'
const META_TABLE = '_meta'

/**
 * DexieStore — IndexedDB-backed Store implementation via Dexie.
 *
 * Takes the dialecteConfig to read table names and schema,
 * but doesn't use Config generics — it stores AnyRawRecord.
 */
export class DexieStore implements Store {
	readonly name: string
	private databaseInstance: Dexie
	private tableName: string

	constructor(databaseName: string, dialecteConfig: AnyDialecteConfig) {
		this.name = databaseName

		const { xmlElements, additionalTables } = dialecteConfig.database.tables

		this.tableName = xmlElements.name
		this.databaseInstance = new Dexie(databaseName)

		const stores: Record<string, string> = {
			[xmlElements.name]: xmlElements.schema,
		}

		if (additionalTables) {
			for (const [tableName, tableConfig] of Object.entries(additionalTables)) {
				stores[tableName] = tableConfig.schema
			}
		}

		stores[CHANGELOG_TABLE] = '++sequenceNumber, id'
		stores[META_TABLE] = 'key'

		this.databaseInstance.version(1).stores(stores)
	}

	async get(id: string): Promise<AnyRawRecord | undefined> {
		return this.databaseInstance.table(this.tableName).get(id)
	}

	async getByTagName(tagName: string): Promise<AnyRawRecord[]> {
		return this.databaseInstance.table(this.tableName).where({ tagName }).toArray()
	}

	private get changeLogTable() {
		return this.databaseInstance.table<ChangeLogEntry>(CHANGELOG_TABLE)
	}

	private get metaTable() {
		return this.databaseInstance.table<ChangeLogMeta>(META_TABLE)
	}

	private async getHead(): Promise<number> {
		const meta = await this.metaTable.get('head')
		return meta?.value ?? 0
	}

	private async setHead(value: number): Promise<void> {
		await this.metaTable.put({ key: 'head', value })
	}

	async commit(params: {
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		const { creates, updates, deletes, onProgress } = params
		const table = this.databaseInstance.table(this.tableName)
		const total = creates.length + updates.length + deletes.length
		let completed = 0

		try {
			await this.databaseInstance.transaction(
				'rw',
				table,
				this.changeLogTable,
				this.metaTable,
				async () => {
					// Snapshot before-state for undo/redo
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
							const failedRecord = this.extractFailedRecordFromError(error, creates)
							throwDialecteError('STORE_BULK_ADD_FAILED', {
								detail: error instanceof Error ? error.message : String(error),
								cause: error instanceof Error ? error : undefined,
								...(failedRecord && {
									ref: { tagName: failedRecord.tagName!, id: failedRecord.id! },
								}),
							})
						}
					}

					if (updates.length > 0) {
						try {
							await table.bulkPut(updates)
							completed += updates.length
							onProgress(completed, total)
						} catch (error) {
							const failedRecord = this.extractFailedRecordFromError(error, updates)
							throwDialecteError('STORE_BULK_UPDATE_FAILED', {
								detail: error instanceof Error ? error.message : String(error),
								cause: error instanceof Error ? error : undefined,
								...(failedRecord && {
									ref: { tagName: failedRecord.tagName!, id: failedRecord.id! },
								}),
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

					// Trim any redoable future (new commit after undo)
					const head = await this.getHead()
					await this.changeLogTable.where('sequenceNumber').above(head).delete()

					const newSeq = head + 1
					const entry: ChangeLogEntry = {
						id: crypto.randomUUID(),
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
					await this.changeLogTable.add(entry)
					await this.setHead(newSeq)
				},
			)
		} catch (error) {
			// Dexie transaction wrapper errors (e.g., transaction aborted)
			if (error instanceof Error && error.message.includes('dialecte')) {
				// Already a DialecteError from above catches, rethrow as-is
				throw error
			}
			throwDialecteError('STORE_COMMIT_FAILED', {
				detail: error instanceof Error ? error.message : String(error),
				cause: error instanceof Error ? error : undefined,
			})
		}
	}

	private extractFailedRecordFromError(
		error: unknown,
		records: AnyRawRecord[],
	): Partial<AnyRawRecord> | undefined {
		// Dexie errors sometimes include the key that failed
		if (error instanceof Error && 'failures' in error) {
			const failures = (error as any).failures as Array<{ key: string }>
			if (failures && failures.length > 0) {
				const failedKey = failures[0].key
				return records.find((r) => r.id === failedKey)
			}
		}
		// Fallback: return first record
		return records[0]
	}

	async clear(): Promise<void> {
		await this.databaseInstance.table(this.tableName).clear()
		await this.changeLogTable.clear()
		await this.metaTable.clear()
	}

	async undo(): Promise<void> {
		const head = await this.getHead()
		if (head === 0) {
			return
		}

		const entry = await this.changeLogTable.where({ sequenceNumber: head }).first()
		if (!entry) {
			return
		}

		const table = this.databaseInstance.table(this.tableName)

		await this.databaseInstance.transaction('rw', table, this.metaTable, async () => {
			const { creates, updates, deletes } = entry.operations

			// Invert: remove records that were created
			if (creates.length > 0) {
				await table.bulkDelete(creates.map((r) => r.id))
			}

			// Invert: restore records to their before-state
			if (updates.length > 0) {
				await table.bulkPut(updates.map((u) => u.before))
			}

			// Invert: re-add records that were deleted
			if (deletes.length > 0) {
				await table.bulkAdd(deletes)
			}

			await this.setHead(head - 1)
		})
	}

	async redo(): Promise<void> {
		const head = await this.getHead()
		const next = head + 1

		const entry = await this.changeLogTable.where({ sequenceNumber: next }).first()
		if (!entry) {
			return
		}

		const table = this.databaseInstance.table(this.tableName)

		await this.databaseInstance.transaction('rw', table, this.metaTable, async () => {
			const { creates, updates, deletes } = entry.operations

			if (creates.length > 0) {
				await table.bulkAdd(creates)
			}

			if (updates.length > 0) {
				await table.bulkPut(updates.map((u) => u.after))
			}

			if (deletes.length > 0) {
				await table.bulkDelete(deletes.map((r) => r.id))
			}

			await this.setHead(next)
		})
	}

	async getChangeLog(): Promise<ChangeLogEntry[]> {
		return this.changeLogTable.orderBy('sequenceNumber').toArray()
	}

	async open(): Promise<void> {
		await this.databaseInstance.open()
	}

	close(): void {
		this.databaseInstance.close()
	}

	async destroy(): Promise<void> {
		if (this.databaseInstance.isOpen()) {
			this.databaseInstance.close()
			// Small delay to let IndexedDB fully close before deletion
			await new Promise((resolve) => setTimeout(resolve, 20))
		}

		//await this.databaseInstance.delete()
		await Dexie.delete(this.databaseInstance.name)
	}
}
