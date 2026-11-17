import { pushedFilterOf } from './pushed-filter'
import { stagedAnswerOf } from './staged-answer'

import { getRecordsByTagName, isTransactionContext } from '@/document'
import { countRecordsMoved } from '@/document/query/get/record/count-records-moved'
import { declaredAttributeTypeOf, declaredDefinitionOf } from '@/utils/qname-definition'
import { qualifiedNameAttributesOf, readsQualifiedNames } from '@/utils/qname-typed'
import { canonicalQNameValue, storedNamespaceLookup } from '@/utils/qname-value'
import { canonicalXsiType, isXsiTypeAttribute } from '@/utils/xsi-type'

import type { Context, FilterAttributes } from '@/document'
import type { AttributeLookup } from '@/store'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	RawRecord,
	ResolvedDefinition,
	TrackedRecord,
	ElementsOf,
	AttributesOf,
} from '@/types'

/**
 * Find elements by tagName and attributes.
 * Core primitive for all query operations.
 * Returns all records matching tagName and attributes - no scope filtering.
 *
 * The plain attributes of the filter (`pushedFilterOf`) go to the store's attribute lookup when it has one, a list of
 * values in the same call; the staged writes are laid over its answer from the staged indexes. A store without the
 * lookup, or a filter with nothing to push, reads the tag and filters it. Either way the same records, in the same
 * order.
 *
 * @internal the context-level read behind `doc.query.findByAttributes`; callers use the query
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

	const filter = pushedFilterOf({
		dialecteConfig: context.dialecteConfig,
		tagName,
		attributes: attributes as Record<string, unknown> | undefined,
	})
	if (filter.kind === 'unmatchable') return []
	if (filter.kind === 'pushed' && context.store.getByAttributes) {
		return findByPushedAttributes({ context, tagName, attributes, pushed: filter.attributes })
	}

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

/** The store's lookup of the pushed attributes, one call, with the staged writes laid over it. */
// dialecte-allow argument-mutation: a transaction's record cache is filled by its reads, as a tag read fills it
async function findByPushedAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	tagName: GenericElement
	attributes: FilterAttributes<GenericConfig, GenericElement>
	pushed: AttributeLookup['attributes']
}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
	const { context, tagName, attributes, pushed } = params
	context.perf.count('core::store::getByAttributes')
	const stored = (await context.store.getByAttributes!({
		documentId: context.documentId,
		tagName,
		attributes: pushed,
	})) as RawRecord<GenericConfig, GenericElement>[]
	countRecordsMoved({ perf: context.perf, member: 'getByAttributes', records: stored })

	if (isTransactionContext(context)) {
		for (const record of stored) context.recordCache.set(record.id, record)
	}

	return stagedAnswerOf({
		stagedOperations: context.stagedOperations,
		tagName,
		matches: function matchesFilter(record) {
			return matchesAttributeFilter({
				dialecteConfig: context.dialecteConfig,
				record,
				attributeFilter: attributes,
			})
		},
		pushed,
		stored,
	})
}

/**
 * Checks if a record's attributes match the given filter criteria.
 * - Multiple attributes: AND logic (all must match)
 * - Array values: OR logic (matches if attribute equals any value)
 * - Undefined values: ignored (attribute removed from filter)
 * - `xsi:type`: compared as the type it names, whatever form the filter writes it in (local name, dialecte prefix,
 *   Clark name) or the record holds it in
 * - a QName-typed attribute: the filter's value read as a write reads it (`xs:integer` and the Clark name of the same
 *   type are one filter), compared with the stored form
 *
 * @internal the attribute filter of `findByAttributes` and `getTree`'s `where`
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

	const qualifiedNames = qualifiedNameFilterOf({ dialecteConfig, record })
	for (const [attributeName, rawExpected] of Object.entries(attributeFilter)) {
		if (rawExpected === undefined) continue
		const expectedValues = qualifiedNames(attributeName, rawExpected)

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
		namespaceOf: storedNamespaceLookup({ dialecteConfig }),
	})
	// the filter's as XML reads it: unprefixed is the default namespace, a dialecte prefix its namespace
	const namespaceOf = storedNamespaceLookup({ dialecteConfig })
	const values = (Array.isArray(expected) ? expected : [expected]).filter(
		(value): value is string => typeof value === 'string',
	)
	return values.some((value) => canonicalXsiType({ dialecteConfig, value, namespaceOf }) === actual)
}

/**
 * How the filter reads its values for the record: a QName-typed attribute's in stored form (read with the engine
 * table), any other as given. The record's definition is read only when the filter names an attribute its tag may
 * hold as QName-typed (`qualifiedNameAttributesOf`), once.
 */
function qualifiedNameFilterOf(params: {
	dialecteConfig: AnyDialecteConfig
	record: AnyRawRecord
}): (attributeName: string, expected: unknown) => unknown {
	const { dialecteConfig, record } = params
	const qualifiedAttributes = qualifiedNameAttributesOf({ dialecteConfig, tagName: record.tagName })
	if (qualifiedAttributes.size === 0) return keepAsGiven
	let definition: ResolvedDefinition | undefined
	let resolved = false
	function definitionOfRecord(): ResolvedDefinition | undefined {
		if (!resolved) definition = declaredDefinitionOf({ dialecteConfig, record })
		resolved = true
		return definition
	}
	const namespaceOf = storedNamespaceLookup({ dialecteConfig })
	return function storedFormOf(attributeName, expected) {
		if (!qualifiedAttributes.has(attributeName)) return expected
		const declared = definitionOfRecord()
		if (declared === undefined) return expected
		// the record's attribute of that name, read as declared (a foreign homonym of the name is not QName-typed)
		const attribute = record.attributes.find((candidate) => candidate.name === attributeName)
		const type =
			attribute === undefined
				? undefined
				: declaredAttributeTypeOf({ definition: declared, attribute })
		if (type === undefined || !readsQualifiedNames(type)) return expected
		const qualifiedType = type
		function canonical(value: unknown): unknown {
			if (typeof value !== 'string') return value
			return canonicalQNameValue({ dialecteConfig, type: qualifiedType, value, namespaceOf })
		}
		return Array.isArray(expected) ? expected.map(canonical) : canonical(expected)
	}
}

function keepAsGiven(_attributeName: string, expected: unknown): unknown {
	return expected
}
