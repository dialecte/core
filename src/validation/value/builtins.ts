import { isDecimalWithin, parseDecimal, parseInteger } from './decimal'
import { URI_FIRST_SEGMENT, URI_SCHEME } from './lexical.constants'
import { isXmlCharacters } from './names'

import type { AtomicValue, ParseAtomic, ParseAtomicParams } from './validate-value.types'

/** A decimal built-in. */
export function parseDecimalValue(params: ParseAtomicParams): AtomicValue | undefined {
	const value = parseDecimal(params.lexical)
	return value === undefined ? undefined : { kind: 'decimal', value }
}

/** An integer built-in, its value within inclusive bounds (absent for none), written as integers. */
export function integerWithin(params: { min?: string; max?: string }): ParseAtomic {
	const min = params.min === undefined ? undefined : BigInt(params.min)
	const max = params.max === undefined ? undefined : BigInt(params.max)
	return function parseIntegerValue({ lexical }) {
		const value = parseInteger(lexical)
		if (value === undefined || !isDecimalWithin({ value, min, max })) return undefined
		return { kind: 'decimal', value }
	}
}

/** A built-in whose lexical space is every string. */
export function parseAnyString(params: ParseAtomicParams): AtomicValue {
	return { kind: 'string', value: params.lexical }
}

/** A built-in of the string family: XML characters that the built-in's own lexical test (if any) admits. */
export function stringMatching(test?: (value: string) => boolean): ParseAtomic {
	return function parseStringValue({ lexical }) {
		if (!isXmlCharacters(lexical) || (test !== undefined && !test(lexical))) return undefined
		return { kind: 'string', value: lexical }
	}
}

/** `true` / `1` and `false` / `0`. */
export function parseBoolean(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical } = params
	if (lexical === 'true' || lexical === '1') return { kind: 'boolean', value: true }
	if (lexical === 'false' || lexical === '0') return { kind: 'boolean', value: false }
	return undefined
}

/**
 * A URI reference, as libxml2 reads one: any XML characters (those a URI cannot hold are escaped first), whose
 * percent escapes are complete, which has one fragment at most, and whose first segment holds a `:` only after a
 * scheme (`urn:x`, not `12:00` nor `:a`).
 */
export function parseAnyUri(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical } = params
	if (!isXmlCharacters(lexical) || /%(?![0-9A-Fa-f]{2})/.test(lexical)) return undefined
	if (lexical.indexOf('#') !== lexical.lastIndexOf('#')) return undefined
	if (!hasSchemeOrNoColon(lexical)) return undefined
	return { kind: 'string', value: lexical }
}

/** Whether a URI reference's first segment holds no `:`, or holds one after a scheme. */
function hasSchemeOrNoColon(lexical: string): boolean {
	const firstSegment = URI_FIRST_SEGMENT.exec(lexical)?.[0] ?? ''
	const colon = firstSegment.indexOf(':')
	return colon === -1 || URI_SCHEME.test(firstSegment.slice(0, colon))
}
