import { mergeOperations } from './merge-operations'

import { dialecteState } from '@/dialecte'
import { createError } from '@/errors'

import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ElementsOf, Context } from '@/types'

/**
 * Commit all staged operations to the database atomically.
 * Terminal operation - returns Promise<void>, operations cleared after success.
 *
 * @param contextPromise - Current builder context
 * @param dialecteConfig - Dialecte configuration
 * @returns Async function to commit operations (terminal, returns void)
 */
export function createCommitMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	return async function commit(): Promise<void> {
		const { contextPromise, dialecteConfig, databaseInstance } = params

		const elementsTableName = dialecteConfig.database.tables.xmlElements.name
		const elementsTable = databaseInstance.table(elementsTableName)
		const context = structuredClone(await contextPromise)

		// Merge operations by element ID to optimize DB operations
		const { creates, updates, deletes } = mergeOperations(context.stagedOperations)

		const totalOperations = creates.length + updates.length + deletes.length

		// Use Dexie transaction for atomicity
		dialecteState.updateEndingProgress({
			current: 0,
			total: totalOperations,
			operation: 'Committing changes',
		})

		try {
			await databaseInstance.transaction('rw', elementsTable, async () => {
				let completed = 0

				// Apply creates
				if (creates.length > 0) {
					await elementsTable.bulkAdd(creates.map((operation) => operation.newRecord))
					completed += creates.length
					dialecteState.updateEndingProgress({
						current: completed,
						total: totalOperations,
						operation: `Created ${creates.length} elements`,
					})
				}

				// Apply updates
				if (updates.length > 0) {
					await elementsTable.bulkPut(updates.map((operation) => operation.newRecord))
					completed += updates.length
					dialecteState.updateEndingProgress({
						current: completed,
						total: totalOperations,
						operation: `Updated ${updates.length} elements`,
					})
				}

				// Apply deletes
				if (deletes.length > 0) {
					await elementsTable.bulkDelete(deletes.map((operation) => operation.oldRecord.id))
					completed += deletes.length
					dialecteState.updateEndingProgress({
						current: completed,
						total: totalOperations,
						operation: `Deleted ${deletes.length} elements`,
					})
				}
			})

			// Clear operations list after successful commit
			context.stagedOperations = []

			dialecteState.setComplete()
		} catch (error) {
			const commitError = createError({
				errorKey: 'DATABASE_COMMIT_ERROR',
				context: {
					method: 'commit',
					currentFocus: context.currentFocus,
					operations: context.stagedOperations,
					originalError: error,
				},
			})
			dialecteState.setError(commitError)
			throw commitError
		}
	}
}
