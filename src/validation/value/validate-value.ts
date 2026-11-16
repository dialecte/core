import { ATOMIC_BUILTINS, LIST_BUILTINS } from './builtins.constants'
import { facetIssue } from './facets'
import { effectiveWhiteSpace, normalizeWhiteSpace } from './whitespace'

import type {
	CheckedValue,
	ListValue,
	SimpleValue,
	ValidateValueParams,
	ValueIssue,
} from './validate-value.types'
import type { DataType } from '@/types'
import type { NamespaceLookup } from '@/utils/xsi-type.types'

/**
 * Whether a simple value is one its datatype admits; the first refusing step says why. Whitespace first (the
 * built-in's, tightened by a `whiteSpace` facet), then the built-in's lexical and value space, a list's items, a
 * union's first accepting member, then the type's own facets. Returns why the value is refused, as plain data, or
 * `undefined` when it is admitted.
 *
 * @intent check a value against its XSD datatype, built-in, facets, list and union
 */
export function validateValue(params: ValidateValueParams): ValueIssue | undefined {
	const { value, type } = params
	return checkValue({
		value,
		type,
		namespaces: params.namespaces ?? noNamespaces,
		schemaLiteral: false,
	}).issue
}

/** A value checked against a datatype: why it is refused, or its normalized form and its value. */
export function checkValue(params: {
	value: string
	type: DataType
	namespaces: NamespaceLookup
	schemaLiteral: boolean
}): CheckedValue {
	const { type } = params
	if ('list' in type) return checkList({ ...params, type })
	if ('union' in type) return checkUnion({ ...params, type })
	const listType = listBuiltinType(type)
	if (listType !== undefined) return checkList({ ...params, type: listType })
	return checkAtomic({ ...params, type })
}

/** A list built-in (`NMTOKENS`, `IDREFS`, `ENTITIES`) as the list it is - one item at least - built once per type. */
function listBuiltinType(
	type: Extract<DataType, { builtin: string }>,
): Extract<DataType, { list: DataType }> | undefined {
	const item = LIST_BUILTINS[type.builtin]
	if (item === undefined) return undefined
	const known = listTypes.get(type)
	if (known !== undefined) return known
	const listType = { list: { builtin: item }, facets: { minLength: 1, ...type.facets } }
	listTypes.set(type, listType)
	return listType
}

function checkAtomic(params: {
	value: string
	type: Extract<DataType, { builtin: string }>
	namespaces: NamespaceLookup
	schemaLiteral: boolean
}): CheckedValue {
	const { value, type, namespaces, schemaLiteral } = params
	const builtin = ATOMIC_BUILTINS[type.builtin]
	const whiteSpace = effectiveWhiteSpace({
		builtin: builtin?.whiteSpace ?? 'preserve',
		facet: type.facets?.whiteSpace,
	})
	const actual = normalizeWhiteSpace({ value, whiteSpace })
	const parsed =
		builtin === undefined
			? { kind: 'string' as const, value: actual }
			: builtin.parse({ lexical: actual, namespaces, schemaLiteral })
	if (parsed === undefined) return { issue: { reason: 'datatype', actual, expected: type.builtin } }
	const issue = facetIssue({ actual, value: parsed, type, literalValue: literalReader(type) })
	return issue === undefined ? { actual, value: parsed } : { issue }
}

/** A list: collapsed, split on spaces, each item against the item type, then the list's own facets. */
function checkList(params: {
	value: string
	type: Extract<DataType, { list: DataType }>
	namespaces: NamespaceLookup
	schemaLiteral: boolean
}): CheckedValue {
	const { value, type, namespaces, schemaLiteral } = params
	const actual = normalizeWhiteSpace({ value, whiteSpace: 'collapse' })
	const checkedItems = (actual === '' ? [] : actual.split(' ')).map((item) =>
		checkValue({ value: item, type: type.list, namespaces, schemaLiteral }),
	)
	const refused = checkedItems.find((checked) => checked.issue !== undefined)
	if (refused !== undefined) return refused
	const listValue: ListValue = {
		kind: 'list',
		items: checkedItems
			.filter(isAdmitted)
			.flatMap(({ value: item }) => (item.kind === 'list' ? item.items : [item])),
	}
	const issue = facetIssue({ actual, value: listValue, type, literalValue: literalReader(type) })
	return issue === undefined ? { actual, value: listValue } : { issue }
}

/** A union: the first member that admits the value (its normalization and value), then the union's own facets. */
function checkUnion(params: {
	value: string
	type: Extract<DataType, { union: readonly DataType[] }>
	namespaces: NamespaceLookup
	schemaLiteral: boolean
}): CheckedValue {
	const { value, type, namespaces, schemaLiteral } = params
	for (const member of type.union) {
		const checked = checkValue({ value, type: member, namespaces, schemaLiteral })
		if (checked.issue !== undefined) continue
		const issue = facetIssue({ ...checked, type, literalValue: literalReader(type) })
		return issue === undefined ? checked : { issue }
	}
	const actual = normalizeWhiteSpace({ value, whiteSpace: 'collapse' })
	return { issue: { reason: 'datatype', actual, expected: type.union.map(describeType) } }
}

/** A datatype as an issue names it: its built-in, `list of …`, or its members joined with `|`. */
function describeType(type: DataType): string {
	if ('list' in type) return `list of ${describeType(type.list)}`
	if ('union' in type) return type.union.map(describeType).join(' | ')
	return type.builtin
}

/**
 * How the facet values of a datatype read: as the datatype without its own facets reads a value (its whitespace
 * kept), each read once per datatype.
 */
function literalReader(type: DataType): (literal: string) => SimpleValue | undefined {
	return function literalValue(literal) {
		const read = literalValues.get(type) ?? new Map<string, SimpleValue | undefined>()
		literalValues.set(type, read)
		if (!read.has(literal)) {
			const checked = checkValue({
				value: literal,
				type: withoutOwnFacets(type),
				namespaces: noNamespaces,
				schemaLiteral: true,
			})
			read.set(literal, checked.issue === undefined ? checked.value : undefined)
		}
		return read.get(literal)
	}
}

function isAdmitted(
	checked: CheckedValue,
): checked is Extract<CheckedValue, { value: SimpleValue }> {
	return checked.issue === undefined
}

function withoutOwnFacets(type: DataType): DataType {
	const whiteSpace = type.facets?.whiteSpace
	const facets = whiteSpace === undefined ? undefined : { whiteSpace }
	if ('list' in type) return { list: type.list }
	if ('union' in type) return { union: type.union }
	return facets === undefined ? { builtin: type.builtin } : { builtin: type.builtin, facets }
}

const listTypes = new WeakMap<DataType, Extract<DataType, { list: DataType }>>()

const literalValues = new WeakMap<DataType, Map<string, SimpleValue | undefined>>()

/** A lookup with no namespace bound (the `xml` prefix is bound whatever the lookup). */
function noNamespaces(): undefined {
	return undefined
}
