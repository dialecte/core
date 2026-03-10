import type { AnyDialecteConfig, Operation } from '@/types'

/**
 * Merge operations by element ID to optimize database operations.
 * Consolidates multiple operations on the same element into a single final operation.
 *
 * Merge rules:
 * - created + updated → created (with final state)
 * - created + deleted → no-op (removed)
 * - updated + updated → updated (with final state)
 * - updated + deleted → deleted (with original old state)
 * - deleted → terminal (no further merging)
 *
 * @param operations - Array of staged operations to merge
 * @returns Object containing arrays of merged creates, updates, and deletes
 */
export function mergeOperations<GenericConfig extends AnyDialecteConfig>(
	operations: Operation<GenericConfig>[],
) {
	const operationMap = new Map<string, Operation<GenericConfig>>()

	for (const operation of operations) {
		const elementId = (operation.status === 'deleted' ? operation.oldRecord : operation.newRecord)
			.id
		const existing = operationMap.get(elementId)

		if (!existing) {
			operationMap.set(elementId, operation)
			continue
		}

		// Merge rules based on operation sequence
		if (existing.status === 'created') {
			if (operation.status === 'updated') {
				// created + updated → created with final state
				operationMap.set(elementId, {
					status: 'created',
					oldRecord: undefined,
					newRecord: operation.newRecord,
				})
			} else if (operation.status === 'deleted') {
				// created + deleted → no-op (element never persisted)
				operationMap.delete(elementId)
			}
		} else if (existing.status === 'updated') {
			if (operation.status === 'updated') {
				// updated + updated → updated with final state
				operationMap.set(elementId, {
					status: 'updated',
					oldRecord: existing.oldRecord,
					newRecord: operation.newRecord,
				})
			} else if (operation.status === 'deleted') {
				// updated + deleted → deleted with original old
				operationMap.set(elementId, {
					status: 'deleted',
					oldRecord: existing.oldRecord,
					newRecord: undefined,
				})
			}
		}
		// deleted operations are terminal - no further merging
	}

	// Extract final operations by type
	const mergedOperations = Array.from(operationMap.values())

	return {
		creates: mergedOperations.filter((op) => op.status === 'created'),
		updates: mergedOperations.filter((op) => op.status === 'updated'),
		deletes: mergedOperations.filter((op) => op.status === 'deleted'),
	}
}
