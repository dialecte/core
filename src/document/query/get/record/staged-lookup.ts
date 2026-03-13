import { throwDialecteError } from '@/errors'
import { isRecordOf } from '@/helpers'

import type {
	AnyDialecteConfig,
	Operation,
	OperationStatus,
	ElementsOf,
	TrackedRecord,
	RawRecord,
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
