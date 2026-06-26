import { throwDialecteError } from '@/errors'
import { isRecordOf } from '@/helpers'

import type {
	AnyDialecteConfig,
	Operation,
	OperationStatus,
	ElementsOf,
	TrackedRecord,
	RawRecord,
	AnyRawRecord,
	AnyTrackedRecord,
} from '@/types'

/**
 * Find the latest staged operation matching a record id.
 * Scans operations in reverse (most recent first).
 *
 * When id is omitted (singleton), matches by tagName only.
 *
 * Pure function — no DB access, no side effects.
 *
 * @returns The record + operation status, or undefined if not in staged ops
 */
export function getLatestStagedRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	stagedOperations: ReadonlyArray<Operation<GenericConfig>>
	tagName: GenericElement
	id?: string
}): TrackedRecord<GenericConfig, GenericElement> | undefined {
	const { stagedOperations, tagName, id } = params

	for (let i = stagedOperations.length - 1; i >= 0; i--) {
		const operation = stagedOperations[i]

		// Singleton path — no id provided, match by tagName only
		if (id === undefined) {
			if (
				(operation.status === 'created' || operation.status === 'updated') &&
				isRecordOf(operation.newRecord, tagName)
			) {
				return {
					...(operation.newRecord as RawRecord<GenericConfig, GenericElement>),
					status: operation.status,
				}
			}
			if (operation.status === 'deleted' && isRecordOf(operation.oldRecord, tagName)) {
				return {
					...(operation.oldRecord as RawRecord<GenericConfig, GenericElement>),
					status: 'deleted',
				}
			}
			continue
		}

		// Normal path — match by id
		if (operation.status === 'created' && operation.newRecord.id === id) {
			const actualTagName: string = operation.newRecord.tagName
			if (actualTagName !== tagName) {
				throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
					detail: `Expected tagName '${tagName}', got '${actualTagName}' for id '${id}'`,
					ref: { tagName, id },
				})
			}
			return {
				...(operation.newRecord as RawRecord<GenericConfig, GenericElement>),
				status: 'created',
			}
		}
		if (operation.status === 'updated' && operation.newRecord.id === id) {
			const actualTagName: string = operation.newRecord.tagName
			if (actualTagName !== tagName) {
				throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
					detail: `Expected tagName '${tagName}', got '${actualTagName}' for id '${id}'`,
					ref: { tagName, id },
				})
			}
			return {
				...(operation.newRecord as RawRecord<GenericConfig, GenericElement>),
				status: 'updated',
			}
		}
		if (operation.status === 'deleted' && operation.oldRecord.id === id) {
			const actualTagName: string = operation.oldRecord.tagName
			if (actualTagName !== tagName) {
				throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
					detail: `Expected tagName '${tagName}', got '${actualTagName}' for id '${id}'`,
					ref: { tagName, id },
				})
			}
			return {
				...(operation.oldRecord as RawRecord<GenericConfig, GenericElement>),
				status: 'deleted',
			}
		}
	}

	return undefined
}

/**
 * Overlay staged operations on top of DB records for a given tagName.
 * Applies creates/updates/deletes to produce the final merged array.
 *
 * Pure function — no DB access, no side effects.
 *
 * @returns Merged array with status: DB records get 'unchanged', staged records get their operation status
 */
export function overlayStaged<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	rawRecords: RawRecord<GenericConfig, GenericElement>[]
	stagedOperations: ReadonlyArray<Operation<GenericConfig>>
}): TrackedRecord<GenericConfig, GenericElement>[] {
	const { rawRecords, stagedOperations, tagName } = params

	const recordsById = new Map(
		rawRecords.map((r) => [r.id, { ...r, status: 'unchanged' as OperationStatus }]),
	)

	for (const operation of stagedOperations) {
		if (operation.status === 'created' || operation.status === 'updated') {
			if (!isRecordOf(operation.newRecord, tagName)) continue

			recordsById.set(operation.newRecord.id, { ...operation.newRecord, status: operation.status })
		}

		if (operation.status === 'deleted' && operation.oldRecord.tagName === tagName) {
			recordsById.delete(operation.oldRecord.id)
		}
	}

	return Array.from(recordsById.values())
}

/**
 * Overlay staged operations on top of every DB record (all tag names).
 *
 * Applies creates/updates by id and removes deletes, producing the final
 * merged state of a whole document. When `includeDeleted` is set, deleted
 * records are returned separately as tombstones (status `'deleted'`) so callers
 * can re-attach them for a tree view — except records that were both created
 * and deleted in the same staged set (a net no-op that never reaches the store).
 *
 * Pure function — no DB access, no side effects.
 */
export function overlayAllStaged<GenericConfig extends AnyDialecteConfig>(params: {
	rawRecords: AnyRawRecord[]
	stagedOperations: ReadonlyArray<Operation<GenericConfig>>
	includeDeleted?: boolean
}): { live: Map<string, AnyTrackedRecord>; deleted: AnyTrackedRecord[] } {
	const { rawRecords, stagedOperations, includeDeleted = false } = params

	const live = new Map<string, AnyTrackedRecord>(
		rawRecords.map((record) => [record.id, { ...record, status: 'unchanged' as OperationStatus }]),
	)
	const deleted: AnyTrackedRecord[] = []
	const createdIds = new Set<string>()

	for (const operation of stagedOperations) {
		if (operation.status === 'created' || operation.status === 'updated') {
			if (operation.status === 'created') createdIds.add(operation.newRecord.id)
			live.set(operation.newRecord.id, { ...operation.newRecord, status: operation.status })
			continue
		}

		// deleted
		live.delete(operation.oldRecord.id)
		if (includeDeleted && !createdIds.has(operation.oldRecord.id)) {
			deleted.push({ ...operation.oldRecord, status: 'deleted' })
		}
	}

	return { live, deleted }
}

/**
 * Index staged `deleted` operations by their record's original parent id.
 *
 * Deletes are hidden from normal reads (the parent's `children` ref is pruned
 * and `getRecord` drops deleted records), so a snapshot that wants to surface
 * deleted nodes resolves them here instead. The op carries the full `oldRecord`,
 * so no store read is needed. Building the index once lets a tree walk look up
 * each node's deleted children in O(1) instead of rescanning the staged ops.
 *
 * Records both created and deleted in the same staged set are excluded (a net
 * no-op that never reaches the store).
 *
 * Pure function — no DB access, no side effects.
 */
export function indexStagedDeletesByParent<GenericConfig extends AnyDialecteConfig>(
	stagedOperations: ReadonlyArray<Operation<GenericConfig>>,
): Map<string, AnyTrackedRecord[]> {
	const createdIds = new Set<string>()
	for (const operation of stagedOperations) {
		if (operation.status === 'created') createdIds.add(operation.newRecord.id)
	}

	const byParentId = new Map<string, AnyTrackedRecord[]>()
	for (const operation of stagedOperations) {
		if (operation.status !== 'deleted') continue

		const { oldRecord } = operation
		if (createdIds.has(oldRecord.id)) continue

		const parentId = oldRecord.parent?.id
		if (!parentId) continue

		const tombstones = byParentId.get(parentId) ?? []
		tombstones.push({ ...oldRecord, status: 'deleted' })
		byParentId.set(parentId, tombstones)
	}
	return byParentId
}
