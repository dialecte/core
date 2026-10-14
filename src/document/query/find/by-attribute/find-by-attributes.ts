import { getRecordsByTagName } from '@/document'
import { canonicalXsiType, isXsiTypeAttribute, storedNamespaceLookup } from '@/utils/xsi-type'

import type { Context, FilterAttributes } from '@/document'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	TrackedRecord,
	ElementsOf,
	AttributesOf,
} from '@/types'

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
		if (
			matchesAttributeFilter({
				dialecteConfig: context.dialecteConfig,
				record,
				attributeFilter: attributes,
			})
		) {
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
 * - `xsi:type`: compared as the type it names, whatever form the filter writes it in (local name, dialecte prefix,
 *   Clark name) or the record holds it in
 */
export function matchesAttributeFilter<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	record: TrackedRecord<GenericConfig, GenericElement>
	attributeFilter: FilterAttributes<GenericConfig, GenericElement>
}): boolean {
	const { dialecteConfig, record, attributeFilter } = params

	if (!attributeFilter || Object.keys(attributeFilter).length === 0) {
		return true
	}

	for (const [attributeName, expectedValues] of Object.entries(attributeFilter)) {
		if (expectedValues === undefined) continue

		if (attributeName === 'xsi:type') {
			if (!matchesXsiType({ dialecteConfig, record, expected: expectedValues })) return false
			continue
		}

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

/** Whether the type the record names with xsi:type is one the filter names: both read in the form core stores. */
function matchesXsiType(params: {
	dialecteConfig: AnyDialecteConfig
	record: AnyRawRecord
	expected: unknown
}): boolean {
	const { dialecteConfig, record, expected } = params
	const attribute = record.attributes.find(isXsiTypeAttribute)
	if (attribute === undefined || attribute.value === '') return false
	// the record's as stored - a value an earlier core kept as written is read where the record binds its prefix
	const actual = canonicalXsiType({
		dialecteConfig,
		value: attribute.value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig, attributes: record.attributes }),
	})
	// the filter's as XML reads it: unprefixed is the default namespace, a dialecte prefix its namespace
	const namespaceOf = storedNamespaceLookup({ dialecteConfig, attributes: [] })
	const values = (Array.isArray(expected) ? expected : [expected]).filter(
		(value): value is string => typeof value === 'string',
	)
	return values.some((value) => canonicalXsiType({ dialecteConfig, value, namespaceOf }) === actual)
}
