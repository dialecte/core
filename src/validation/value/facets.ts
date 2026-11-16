import { areEqualValues, compareValues } from './compare'
import { REFUSED_ORDERS } from './validate-value.constants'

import { valuePatterns } from '@/utils/datatype'

import type { FacetCheck, RangeFacet, SimpleValue, ValueIssue } from './validate-value.types'
import type { DataType } from '@/types'

/**
 * The first of a datatype's own facets a value fails, in the order enumeration, pattern, length / minLength /
 * maxLength, the range facets, totalDigits / fractionDigits. Enumeration and range compare in value space: a facet
 * value is read as the datatype reads a value (`literalValue`).
 */
export function facetIssue(params: {
	actual: string
	value: SimpleValue
	type: DataType
	literalValue: (literal: string) => SimpleValue | undefined
}): ValueIssue | undefined {
	const { type } = params
	if (type.facets === undefined) return undefined
	const checked = { ...params, facets: type.facets }
	return (
		enumerationIssue(checked) ??
		patternIssue(checked) ??
		lengthIssue(checked) ??
		rangeIssue(checked) ??
		digitsIssue(checked)
	)
}

function enumerationIssue(params: FacetCheck): ValueIssue | undefined {
	const { actual, value, facets, literalValue } = params
	const { enumeration } = facets
	if (enumeration === undefined) return undefined
	const listed = enumeration.some((literal) => {
		const admitted = literalValue(literal)
		return admitted === undefined
			? literal === actual
			: areEqualValues({ left: value, right: admitted })
	})
	return listed
		? undefined
		: { reason: 'enumeration', actual, expected: enumeration, facet: 'enumeration' }
}

/** Every level must match; one pattern of a level is enough. */
function patternIssue(params: FacetCheck): ValueIssue | undefined {
	const { actual, type, facets } = params
	const refusing = valuePatterns(type).findIndex((pattern) => !pattern.test(actual))
	if (refusing === -1) return undefined
	return { reason: 'pattern', actual, expected: facets.pattern?.[refusing], facet: 'pattern' }
}

function lengthIssue(params: FacetCheck): ValueIssue | undefined {
	const { actual, value, facets } = params
	const length = measuredLength({ actual, value })
	if (length === undefined) return undefined
	if (facets.length !== undefined && length !== facets.length)
		return { reason: 'length', actual, expected: facets.length, facet: 'length' }
	if (facets.minLength !== undefined && length < facets.minLength)
		return { reason: 'length', actual, expected: facets.minLength, facet: 'minLength' }
	if (facets.maxLength !== undefined && length > facets.maxLength)
		return { reason: 'length', actual, expected: facets.maxLength, facet: 'maxLength' }
	return undefined
}

/** A value's length as the length facets count it: items of a list, octets of binary data, characters (code points) otherwise; none for a qualified name. */
function measuredLength(params: { actual: string; value: SimpleValue }): number | undefined {
	const { actual, value } = params
	if (value.kind === 'list') return value.items.length
	if (value.kind === 'binary') return value.octets
	if (value.kind === 'qname') return undefined
	return [...actual].length
}

function rangeIssue(params: FacetCheck): ValueIssue | undefined {
	const { actual, value, facets, literalValue } = params
	for (const facet of Object.keys(REFUSED_ORDERS) as RangeFacet[]) {
		const bound = facets[facet]
		if (bound === undefined) continue
		const boundValue = literalValue(bound)
		const order =
			boundValue === undefined ? 'incomparable' : compareValues({ left: value, right: boundValue })
		if (REFUSED_ORDERS[facet].includes(order))
			return { reason: 'range', actual, expected: bound, facet }
	}
	return undefined
}

/**
 * A decimal `i × 10^-n` (`n` its fraction digits, trailing zeros dropped) has `max(digits of i, n)` total digits:
 * leading zeros never count, zeros between the point and the first digit do.
 */
function digitsIssue(params: FacetCheck): ValueIssue | undefined {
	const { actual, value, facets } = params
	if (value.kind !== 'decimal') return undefined
	const { unscaled, scale } = value.value
	const magnitude = unscaled < BigInt(0) ? -unscaled : unscaled
	const totalDigits = Math.max(magnitude.toString().length, scale)
	if (facets.totalDigits !== undefined && totalDigits > facets.totalDigits)
		return { reason: 'digits', actual, expected: facets.totalDigits, facet: 'totalDigits' }
	if (facets.fractionDigits !== undefined && scale > facets.fractionDigits)
		return { reason: 'digits', actual, expected: facets.fractionDigits, facet: 'fractionDigits' }
	return undefined
}
