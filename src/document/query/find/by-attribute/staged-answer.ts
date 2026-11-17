import { stagedIdsMatching } from '@/document/staged-attribute-index'
import { isRecordOf } from '@/helpers'
import { compareById } from '@/store/compare-by-id'

import type { StagedOperations } from '@/document'
import type { AttributeLookup } from '@/store'
import type {
	AnyDialecteConfig,
	ElementsOf,
	OperationStatus,
	RawRecord,
	TrackedRecord,
} from '@/types'

/**
 * A store's attribute lookup answer with the transaction's staged writes over it, as a tag read overlaid and filtered
 * answers, in the same order: each stored record replaced by its staged version (gone when deleted), the staged
 * records whose pushed values match added from the staged attribute index (never by scanning the log), every one
 * re-checked with the whole filter. The ids holding no staged place come first in id order (the stored records, and
 * stored records a staged update made match), then the placed ids in their place order.
 *
 * Pure function — no store access, no side effects.
 *
 * @internal the staged overlay of `findByAttributes` over a store's lookup
 */
export function stagedAnswerOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	stagedOperations: StagedOperations<GenericConfig>
	tagName: GenericElement
	/** The whole filter, as the query layer matches a record (`matchesAttributeFilter`). */
	matches: (record: TrackedRecord<GenericConfig, GenericElement>) => boolean
	pushed: AttributeLookup['attributes']
	stored: RawRecord<GenericConfig, GenericElement>[]
}): TrackedRecord<GenericConfig, GenericElement>[] {
	const { stagedOperations, tagName, matches, pushed, stored } = params
	const { byId, appended } = stagedOperations
	const storedById = new Map(stored.map((record) => [record.id, record]))
	const candidates = new Set([
		...storedById.keys(),
		...stagedIdsMatching({ stagedOperations, tagName, attributes: pushed }),
	])

	const inIdOrder: TrackedRecord<GenericConfig, GenericElement>[] = []
	const placed: { place: number; record: TrackedRecord<GenericConfig, GenericElement> }[] = []
	for (const id of candidates) {
		const record = currentRecordOf({ id, tagName, byId, storedById })
		if (!record) continue
		if (!matches(record)) continue
		const place = appended.get(id)
		if (place === undefined) inIdOrder.push(record)
		else placed.push({ place, record })
	}

	inIdOrder.sort(compareById)
	placed.sort((left, right) => left.place - right.place)
	return [...inIdOrder, ...placed.map(({ record }) => record)]
}

/** The record of the id as the transaction sees it: its staged version, else the stored one; none once deleted. */
function currentRecordOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	id: string
	tagName: GenericElement
	byId: StagedOperations<GenericConfig>['byId']
	storedById: Map<string, RawRecord<GenericConfig, GenericElement>>
}): TrackedRecord<GenericConfig, GenericElement> | undefined {
	const { id, tagName, byId, storedById } = params
	const operation = byId.get(id)
	if (!operation) {
		const record = storedById.get(id)
		return record && { ...record, status: 'unchanged' as OperationStatus }
	}
	if (operation.status === 'deleted' || !isRecordOf(operation.newRecord, tagName)) return undefined
	return {
		...(operation.newRecord as RawRecord<GenericConfig, GenericElement>),
		status: operation.status,
	}
}
