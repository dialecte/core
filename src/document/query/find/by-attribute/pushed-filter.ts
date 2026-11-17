import { qualifiedNameAttributesOf } from '@/utils/qname-typed'

import type { PushedFilter } from './find-by-attributes.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * Split a `findByAttributes` filter for a store's attribute lookup: an attribute is pushed when it is not `xsi:type`
 * and not QName-typed for the tag (both compared as types, not as stored strings), with its string values but `''`
 * (never a match). A pushed attribute left with no value matches no record. What is kept back is still filtered by
 * the query layer, which re-checks every answer.
 *
 * @internal the filter split of `findByAttributes`
 */
export function pushedFilterOf(params: {
	dialecteConfig: AnyDialecteConfig
	tagName: string
	attributes: Record<string, unknown> | undefined
}): PushedFilter {
	const { dialecteConfig, tagName, attributes = {} } = params
	const qualifiedAttributes = qualifiedNameAttributesOf({ dialecteConfig, tagName })
	const pushed: { name: string; values: string[] }[] = []
	for (const [name, expected] of Object.entries(attributes)) {
		// undefined: the attribute is no part of the filter; xsi:type and QName values compare as types
		if (expected === undefined || name === 'xsi:type' || qualifiedAttributes.has(name)) continue
		const values = (Array.isArray(expected) ? expected : [expected]).filter(isMatchableValue)
		if (values.length === 0) return { kind: 'unmatchable' }
		pushed.push({ name, values })
	}
	return pushed.length === 0 ? { kind: 'kept' } : { kind: 'pushed', attributes: pushed }
}

/** A value an attribute can hold and match: a string, never `''` (an attribute of `''` never matches). */
function isMatchableValue(value: unknown): value is string {
	return typeof value === 'string' && value !== ''
}
