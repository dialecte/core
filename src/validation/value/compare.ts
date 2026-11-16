import { instantOf } from './date-time'
import { addDecimals, compareDecimals, wholeDecimal } from './decimal'
import { DURATION_REFERENCES, ZONE_SPAN_SECONDS } from './validate-value.constants'

import type { AtomicValue, Decimal, SimpleValue, ValueOrder } from './validate-value.types'

/** Whether two values are the same value: the same kind and equal in its value space. */
export function areEqualValues(params: { left: SimpleValue; right: SimpleValue }): boolean {
	const { left, right } = params
	if (left.kind === 'list' || right.kind === 'list') {
		if (left.kind !== 'list' || right.kind !== 'list') return false
		return (
			left.items.length === right.items.length &&
			left.items.every((item, index) =>
				areEqualValues({ left: item, right: right.items[index] as AtomicValue }),
			)
		)
	}
	return compareValues({ left, right }) === 0
}

/** The order of two values of an ordered value space. */
export function compareValues(params: { left: SimpleValue; right: SimpleValue }): ValueOrder {
	const { left, right } = params
	switch (left.kind) {
		case 'decimal':
			return right.kind === 'decimal'
				? sign(compareDecimals({ left: left.value, right: right.value }))
				: 'incomparable'
		case 'float':
			return right.kind === 'float'
				? compareFloats({ left: left.value, right: right.value })
				: 'incomparable'
		case 'dateTime':
			if (right.kind !== 'dateTime' || right.primitive !== left.primitive) return 'incomparable'
			return compareInstants({ left, right })
		case 'duration':
			return right.kind === 'duration' ? compareDurations({ left, right }) : 'incomparable'
		case 'string':
			return right.kind === 'string' && right.value === left.value ? 0 : 'incomparable'
		case 'boolean':
			return right.kind === 'boolean' && right.value === left.value ? 0 : 'incomparable'
		case 'qname':
			return right.kind === 'qname' && right.clark === left.clark ? 0 : 'incomparable'
		case 'binary':
			return right.kind === 'binary' && right.canonical === left.canonical ? 0 : 'incomparable'
		case 'list':
			return 'incomparable'
	}
}

/**
 * Two points of the time line. With an offset on one side only, the other is read at both ends of the offsets
 * (+14:00 and -14:00): the order holds when both readings agree, else it is indeterminate.
 */
function compareInstants(params: {
	left: Extract<AtomicValue, { kind: 'dateTime' }>
	right: Extract<AtomicValue, { kind: 'dateTime' }>
}): ValueOrder {
	const { left, right } = params
	if (left.zoned === right.zoned)
		return sign(compareDecimals({ left: left.seconds, right: right.seconds }))
	const [zoned, unzoned, flip] = left.zoned ? [left, right, 1] : [right, left, -1]
	const earliest = addDecimals({ terms: [unzoned.seconds, wholeDecimal(-ZONE_SPAN_SECONDS)] })
	const latest = addDecimals({ terms: [unzoned.seconds, wholeDecimal(ZONE_SPAN_SECONDS)] })
	if (compareDecimals({ left: zoned.seconds, right: earliest }) < 0) return sign(-1 * flip)
	if (compareDecimals({ left: zoned.seconds, right: latest }) > 0) return sign(flip)
	return 'indeterminate'
}

/** Two durations, each added to the four reference points: the order holds when all four agree. */
function compareDurations(params: {
	left: Extract<AtomicValue, { kind: 'duration' }>
	right: Extract<AtomicValue, { kind: 'duration' }>
}): ValueOrder {
	const { left, right } = params
	if (left.months === right.months)
		return sign(compareDecimals({ left: left.seconds, right: right.seconds }))
	const orders = new Set(
		DURATION_REFERENCES.map((reference) =>
			sign(
				compareDecimals({
					left: afterDuration({ ...reference, duration: left }),
					right: afterDuration({ ...reference, duration: right }),
				}),
			),
		),
	)
	const [order] = orders
	return orders.size === 1 && order !== undefined ? order : 'indeterminate'
}

/** The point a duration leads to from the first day of a month (the day needs no clamping). */
function afterDuration(params: {
	year: bigint
	month: number
	duration: Extract<AtomicValue, { kind: 'duration' }>
}): Decimal {
	const { year, month, duration } = params
	const monthIndex = BigInt(month - 1) + duration.months
	const yearShift =
		monthIndex >= BigInt(0) ? monthIndex / BigInt(12) : (monthIndex - BigInt(11)) / BigInt(12)
	return instantOf({
		year: year + yearShift,
		month: Number(monthIndex - yearShift * BigInt(12)) + 1,
		day: 1,
		seconds: duration.seconds,
	})
}

/** IEEE values ordered as XSD 1.0 orders them: `NaN` equals itself and lies above every other value, `INF` included. */
function compareFloats(params: { left: number; right: number }): -1 | 0 | 1 {
	const { left, right } = params
	if (Number.isNaN(left) || Number.isNaN(right))
		return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1
	return left === right ? 0 : left < right ? -1 : 1
}

function sign(value: number): -1 | 0 | 1 {
	return value < 0 ? -1 : value > 0 ? 1 : 0
}
