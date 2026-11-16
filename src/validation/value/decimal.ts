import { DECIMAL_LEXICAL, INTEGER_LEXICAL } from './lexical.constants'

import type { Decimal } from './validate-value.types'

/** A decimal lexical form (`-1.50`, `.5`, `5.`) as its value; `undefined` when it is not one. */
export function parseDecimal(lexical: string): Decimal | undefined {
	const match = DECIMAL_LEXICAL.exec(lexical)
	if (match === null) return undefined
	const [, sign, integerPart = '', fractionPart = ''] = match
	if (integerPart === '' && fractionPart === '') return undefined
	const fraction = fractionPart.replace(/0+$/, '')
	const magnitude = BigInt(`${integerPart}${fraction}` || '0')
	return { unscaled: sign === '-' ? -magnitude : magnitude, scale: fraction.length }
}

/** An integer lexical form (`+5`, `-0`, `007`) as its value; `undefined` when it is not one. */
export function parseInteger(lexical: string): Decimal | undefined {
	if (!INTEGER_LEXICAL.test(lexical)) return undefined
	return { unscaled: BigInt(lexical), scale: 0 }
}

/** The order of two decimals: negative, zero or positive. */
export function compareDecimals(params: { left: Decimal; right: Decimal }): number {
	const { left, right } = params
	const scale = Math.max(left.scale, right.scale)
	const leftScaled = left.unscaled * BigInt(10) ** BigInt(scale - left.scale)
	const rightScaled = right.unscaled * BigInt(10) ** BigInt(scale - right.scale)
	return leftScaled === rightScaled ? 0 : leftScaled < rightScaled ? -1 : 1
}

/** Whether a decimal lies within inclusive bounds, each absent for none. */
export function isDecimalWithin(params: {
	value: Decimal
	min: bigint | undefined
	max: bigint | undefined
}): boolean {
	const { value, min, max } = params
	if (min !== undefined && compareDecimals({ left: value, right: { unscaled: min, scale: 0 } }) < 0)
		return false
	if (max !== undefined && compareDecimals({ left: value, right: { unscaled: max, scale: 0 } }) > 0)
		return false
	return true
}

/** The sum of decimals. */
export function addDecimals(params: { terms: readonly Decimal[] }): Decimal {
	const { terms } = params
	const scale = Math.max(0, ...terms.map((term) => term.scale))
	const unscaled = terms.reduce(
		(sum, term) => sum + term.unscaled * BigInt(10) ** BigInt(scale - term.scale),
		BigInt(0),
	)
	return { unscaled, scale }
}

/** A whole number as a decimal. */
export function wholeDecimal(value: bigint): Decimal {
	return { unscaled: value, scale: 0 }
}
