import { getAttributeValueByName } from '@/utils'

import { fetchRecords } from '..'

import type { FilterAttributes } from './types'
import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, Context, ChainRecord, ElementsOf, RawRecord } from '@/types'

/**
 * Find elements by tagName and attributes.
 * Core primitive for all query operations.
 * Returns all records matching tagName and attributes - no scope filtering.
 */
export async function findByAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	tagName: GenericElement
	attributes?: FilterAttributes<GenericConfig, GenericElement>
}): Promise<ChainRecord<GenericConfig, GenericElement>[]> {
	const { context, dialecteConfig, databaseInstance, tagName, attributes } = params

	const candidateRecords = await fetchRecords({
		tagName,
		stagedOperations: context.stagedOperations,
		dialecteConfig: dialecteConfig,
		databaseInstance,
		type: 'chain',
	})

	const matchingByAttributes = candidateRecords.filter((candidateRecord) =>
		matchesAttributeFilter(candidateRecord, attributes),
	)

	return matchingByAttributes
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
>(
	record: RawRecord<GenericConfig, GenericElement>,
	attributeFilter?: FilterAttributes<GenericConfig, GenericElement>,
): boolean {
	if (!attributeFilter || Object.keys(attributeFilter).length === 0) {
		return true
	}

	for (const [attributeName, expectedValues] of Object.entries(attributeFilter)) {
		if (expectedValues === undefined) continue

		const actualValue = getAttributeValueByName({
			attributes: record.attributes,
			name: attributeName,
		})

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
