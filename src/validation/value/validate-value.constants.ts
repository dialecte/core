import { XSI_NAMESPACE } from '@/helpers/constant'

import type { FormValueTarget, RangeFacet, ValueOrder, WhiteSpace } from './validate-value.types'

/** How far each whitespace normalization goes: a derived type may only go further. */
export const WHITESPACE_STRENGTH: Readonly<Record<WhiteSpace, number>> = {
	preserve: 0,
	replace: 1,
	collapse: 2,
}

/** The widest offset a time zone may take (14:00), in seconds. */
export const ZONE_SPAN_SECONDS = BigInt(14) * BigInt(3600)

/** The four points durations are compared from (1696-09-01, 1697-02-01, 1903-03-01, 1903-07-01, UTC). */
export const DURATION_REFERENCES: readonly { readonly year: bigint; readonly month: number }[] = [
	{ year: BigInt(1696), month: 9 },
	{ year: BigInt(1697), month: 2 },
	{ year: BigInt(1903), month: 3 },
	{ year: BigInt(1903), month: 7 },
]

/** The orders of the value against a bound each range facet refuses: every order but the one it asks for - an unordered pair is not facet-valid. */
export const REFUSED_ORDERS: Readonly<Record<RangeFacet, readonly ValueOrder[]>> = {
	minInclusive: [-1, 'indeterminate', 'incomparable'],
	minExclusive: [-1, 0, 'indeterminate', 'incomparable'],
	maxInclusive: [1, 'indeterminate', 'incomparable'],
	maxExclusive: [1, 0, 'indeterminate', 'incomparable'],
}

/** The name core stores xsi:type under. */
export const XSI_TYPE_ATTRIBUTE = `${XSI_NAMESPACE.prefix}:type`

/** The target of a value nothing judges: a plain string, untyped text, a wildcard attribute, another `xsi:` attribute. */
export const UNJUDGED: FormValueTarget = { kind: 'unjudged' }
