import { mergeOperations } from './merge-operations'

import type { OperationCounts, OperationsSummary } from './summarize-operations.types'
import type { AnyDialecteConfig, Operation } from '@/types'

/**
 * What staged operations write, counted per record as the commit merges them (a record created then
 * updated is one creation; created then deleted, nothing): totals, and per tag in tag order.
 *
 * @intent count what a transaction will create, update and delete, summarize a prepared transaction per tag, show a confirmation summary before commit
 *
 * @example
 * ```ts
 * const prepared = await doc.prepare(async (tx) => { ... })
 * summarizeOperations(prepared.operations).byTag // { A: { created: 0, updated: 1, deleted: 0 }, ... }
 * ```
 */
export function summarizeOperations<GenericConfig extends AnyDialecteConfig>(
	operations: ReadonlyArray<Operation<GenericConfig>>,
): OperationsSummary {
	const { creates, updates, deletes } = mergeOperations(operations)
	const byTag = new Map<string, OperationCounts>()
	for (const operation of [...creates, ...updates, ...deletes]) {
		const { tagName } = operation.status === 'deleted' ? operation.oldRecord : operation.newRecord
		const counts = byTag.get(tagName) ?? { created: 0, updated: 0, deleted: 0 }
		counts[operation.status] += 1
		byTag.set(tagName, counts)
	}
	return {
		creates: creates.length,
		updates: updates.length,
		deletes: deletes.length,
		byTag: Object.fromEntries([...byTag].sort(([left], [right]) => left.localeCompare(right))),
	}
}
