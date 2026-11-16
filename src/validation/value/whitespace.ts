import { WHITESPACE_STRENGTH } from './validate-value.constants'

import type { WhiteSpace } from './validate-value.types'

/** The whitespace a value is read with: its built-in's, tightened (never loosened) by a `whiteSpace` facet. */
export function effectiveWhiteSpace(params: {
	builtin: WhiteSpace
	facet: WhiteSpace | undefined
}): WhiteSpace {
	const { builtin, facet } = params
	if (facet === undefined) return builtin
	return WHITESPACE_STRENGTH[facet] > WHITESPACE_STRENGTH[builtin] ? facet : builtin
}

/** A value as its whitespace reads it: kept, each tab / line feed / carriage return a space, or collapsed. */
export function normalizeWhiteSpace(params: { value: string; whiteSpace: WhiteSpace }): string {
	const { value, whiteSpace } = params
	if (whiteSpace === 'preserve') return value
	const replaced = value.replace(/[\t\n\r]/g, ' ')
	if (whiteSpace === 'replace') return replaced
	return replaced.replace(/ +/g, ' ').replace(/^ | $/g, '')
}
