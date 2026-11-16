import { FLOAT_LEXICAL } from './lexical.constants'

import type { ParseAtomic } from './validate-value.types'

/** An IEEE value, rounded to single precision for `float`: `INF`, `-INF` and `NaN` included. */
export function floatingPoint(params: { single: boolean }): ParseAtomic {
	const { single } = params
	return function parseFloatingPoint({ lexical }) {
		if (!FLOAT_LEXICAL.test(lexical)) return undefined
		const value = lexical.endsWith('INF')
			? lexical.startsWith('-')
				? -Infinity
				: Infinity
			: Number(lexical)
		return { kind: 'float', value: single ? Math.fround(value) : value }
	}
}
