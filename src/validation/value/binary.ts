import { BASE64_BINARY_LEXICAL, HEX_BINARY_LEXICAL } from './lexical.constants'

import type { AtomicValue, ParseAtomicParams } from './validate-value.types'

/** Hex binary: pairs of hex digits, its value the octets (compared upper-cased). */
export function parseHexBinary(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical } = params
	if (!HEX_BINARY_LEXICAL.test(lexical)) return undefined
	return { kind: 'binary', octets: lexical.length / 2, canonical: lexical.toUpperCase() }
}

/** Base64 as XSD writes it: single spaces may separate the characters (a collapsed value has no other blank). */
export function parseBase64Binary(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical } = params
	const characters = lexical.replaceAll(' ', '')
	if (!BASE64_BINARY_LEXICAL.test(characters)) return undefined
	const padding = characters.endsWith('==') ? 2 : characters.endsWith('=') ? 1 : 0
	return { kind: 'binary', octets: (characters.length / 4) * 3 - padding, canonical: characters }
}
