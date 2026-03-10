import Dexie from 'dexie'

import { AnyRawRecord } from '@/types'

import type { AnyAttribute } from '@/types'
import type { RecordPatch } from '@/types'

/**
 * Add a batch of records to the elements table
 * @param databaseInstance - Database instance
 * @param elementsTableName - Name of the elements table
 * @param records - Array of records to add
 */
export async function bulkAddRecords(params: {
	databaseInstance: Dexie
	elementsTableName: string
	records: AnyRawRecord[]
}): Promise<void> {
	const { databaseInstance, elementsTableName, records } = params

	const elementsTable = databaseInstance.table(elementsTableName)
	await databaseInstance.transaction('rw', elementsTable, () => {
		return elementsTable.bulkAdd(records)
	})
}

/**
 * Bulk update existing records with partial patches.
 * For `attributes`, values are merged by attribute name (existing updated, new appended).
 * All other fields are overwritten directly.
 */
export async function bulkUpdateRecords(params: {
	databaseInstance: Dexie
	elementsTableName: string
	updates: RecordPatch[]
}): Promise<void> {
	const { databaseInstance, elementsTableName, updates } = params

	if (updates.length === 0) return

	const elementsTable = databaseInstance.table(elementsTableName)

	await databaseInstance.transaction('rw', elementsTable, async () => {
		for (const { recordId, ...patch } of updates) {
			const record: AnyRawRecord | undefined = await elementsTable.get(recordId)
			if (!record) continue

			const merged: Partial<Omit<AnyRawRecord, 'id'>> = { ...patch }

			if (patch.attributes) {
				const updatedAttributes = [...record.attributes]
				for (const attr of patch.attributes) {
					const existingIndex = updatedAttributes.findIndex((a) => a.name === attr.name)
					if (existingIndex >= 0) {
						updatedAttributes[existingIndex] = attr
					} else {
						updatedAttributes.push(attr)
					}
				}
				merged.attributes = updatedAttributes
			}

			if (patch.children) {
				const updatedChildren = [...record.children]
				for (const child of patch.children) {
					const existingIndex = updatedChildren.findIndex((c) => c.id === child.id)
					if (existingIndex >= 0) {
						updatedChildren[existingIndex] = child
					} else {
						updatedChildren.push(child)
					}
				}
				merged.children = updatedChildren
			}

			await elementsTable.update(recordId, merged)
		}
	})
}

/**
 * Bulk update attributes on existing records.
 * Used by IO hooks (afterImport) to resolve cross-record references.
 * @deprecated Use bulkUpdateRecords instead.
 */
export async function bulkUpdateRecordAttributes(params: {
	databaseInstance: Dexie
	elementsTableName: string
	updates: Array<{ recordId: string; attributes: AnyAttribute[] }>
}): Promise<void> {
	const { databaseInstance, elementsTableName, updates } = params

	if (updates.length === 0) return

	const elementsTable = databaseInstance.table(elementsTableName)

	await databaseInstance.transaction('rw', elementsTable, async () => {
		for (const { recordId, attributes } of updates) {
			const record: AnyRawRecord | undefined = await elementsTable.get(recordId)
			if (!record) continue

			const updatedAttributes = [...record.attributes]
			for (const attr of attributes) {
				const existingIndex = updatedAttributes.findIndex((a) => a.name === attr.name)
				if (existingIndex >= 0) {
					updatedAttributes[existingIndex] = attr
				} else {
					updatedAttributes.push(attr)
				}
			}

			await elementsTable.update(recordId, { attributes: updatedAttributes })
		}
	})
}

/**
 * Bulk delete records by ID.
 * Used by IO hooks (afterImport) to remove records that should not persist.
 */
export async function bulkDeleteRecords(params: {
	databaseInstance: Dexie
	elementsTableName: string
	ids: string[]
}): Promise<void> {
	const { databaseInstance, elementsTableName, ids } = params

	if (ids.length === 0) return

	const elementsTable = databaseInstance.table(elementsTableName)
	await databaseInstance.transaction('rw', elementsTable, () => {
		return elementsTable.bulkDelete(ids)
	})
}

/**
 * Deletes a Dexie/IndexedDB database if it exists.
 * Closes before deleting if open.
 * @param databaseName Name of the database to delete
 * @returns Promise that resolves when deletion is complete
 */
export async function deleteDatabaseIfExists(databaseName: string): Promise<void> {
	// Check existence
	const doesDatabaseExist = await Dexie.exists(databaseName)
	if (!doesDatabaseExist) return

	// Delete DB
	return await Dexie.delete(databaseName)
}
