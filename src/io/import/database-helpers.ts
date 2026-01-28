import Dexie from 'dexie'

import { AnyRawRecord } from '@/types'

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
