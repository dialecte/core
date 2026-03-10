import { getRecordsByTagName } from '@/document'

import type { Context, FilterAttributes } from '@/document'
import type { AnyDialecteConfig, TrackedRecord, ElementsOf, AttributesOf } from '@/types'

/**
 * Find elements by tagName and attributes.
 * Core primitive for all query operations.
 * Returns all records matching tagName and attributes - no scope filtering.
 */
export async function findByAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	tagName: GenericElement
	attributes: FilterAttributes<GenericConfig, GenericElement>
}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
	const { context, tagName, attributes } = params

	const candidateRecords = await getRecordsByTagName({ context, tagName })

	const matching: TrackedRecord<GenericConfig, GenericElement>[] = []
	for (const record of candidateRecords) {
		if (matchesAttributeFilter({ record, attributeFilter: attributes })) {
			matching.push(record)
		}
	}

	return matching
}

/**
 * Checks if a record's attributes match the given filter criteria.
 * - Multiple attributes: AND logic (all must match)
 * - Array values: OR logic (matches if attribute equals any value)
 * - Undefined values: ignored (attribute removed from filter)
 */
export function matchesAttributeFilter<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record: TrackedRecord<GenericConfig, GenericElement>
	attributeFilter: FilterAttributes<GenericConfig, GenericElement>
}): boolean {
	const { record, attributeFilter } = params

	if (!attributeFilter || Object.keys(attributeFilter).length === 0) {
		return true
	}

	for (const [attributeName, expectedValues] of Object.entries(attributeFilter)) {
		if (expectedValues === undefined) continue

		const attribute = record.attributes.find(
			(attribute) =>
				attribute.name === (attributeName as AttributesOf<GenericConfig, GenericElement>),
		)
		const actualValue = attribute?.value ?? ''

		if (actualValue === '') return false

		if (Array.isArray(expectedValues)) {
			if (!expectedValues.some((expected) => actualValue === expected)) {
				return false
			}
		} else if (actualValue !== expectedValues) {
			return false
		}
	}

	return true
}
