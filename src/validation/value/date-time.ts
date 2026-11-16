import { addDecimals, parseDecimal, wholeDecimal } from './decimal'
import { CALENDAR_FORMS, DURATION_LEXICAL, REFERENCE_YEAR } from './lexical.constants'

import type {
	AtomicValue,
	CalendarParts,
	Decimal,
	ParseAtomic,
	ParseAtomicParams,
} from './validate-value.types'

/** A date / time built-in: its parts in range, its value the point it names on the time line. */
export function calendar(params: { primitive: string }): ParseAtomic {
	const { primitive } = params
	const form = CALENDAR_FORMS[primitive]
	return function parseCalendar({ lexical }) {
		const parts = form?.exec(lexical)?.groups as CalendarParts | undefined
		if (parts === undefined) return undefined
		return calendarValue({ primitive, parts })
	}
}

/** A duration: `PnYnMnDTnHnMnS`, one part at least, its value months and seconds. */
export function parseDuration(params: ParseAtomicParams): AtomicValue | undefined {
	const parts = DURATION_LEXICAL.exec(params.lexical)?.groups
	if (parts === undefined) return undefined
	const { negative, years, months, days, time, hours, minutes, seconds } = parts
	if ([years, months, days, hours, minutes, seconds].every((part) => part === undefined))
		return undefined
	if (time !== undefined && [hours, minutes, seconds].every((part) => part === undefined))
		return undefined
	const sign = negative ? BigInt(-1) : BigInt(1)
	const totalMonths = BigInt(years ?? 0) * BigInt(12) + BigInt(months ?? 0)
	const totalSeconds = addDecimals({
		terms: [
			wholeDecimal(
				BigInt(days ?? 0) * BigInt(86400) +
					BigInt(hours ?? 0) * BigInt(3600) +
					BigInt(minutes ?? 0) * BigInt(60),
			),
			parseDecimal(seconds ?? '0') ?? wholeDecimal(BigInt(0)),
		],
	})
	return {
		kind: 'duration',
		months: sign * totalMonths,
		seconds: { unscaled: sign * totalSeconds.unscaled, scale: totalSeconds.scale },
	}
}

/** The days in a month of a year, the year read as written (no year zero, `-0001` is not a leap year). */
export function daysInMonth(params: { year: bigint; month: number }): number {
	const { year, month } = params
	if (month === 2) return isLeapYear(year) ? 29 : 28
	return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** The point a dateTime of the proleptic Gregorian calendar names, in seconds since 1970-01-01T00:00:00. */
export function instantOf(params: {
	year: bigint
	month: number
	day: number
	seconds: Decimal
}): Decimal {
	const { year, month, day, seconds } = params
	return addDecimals({
		terms: [wholeDecimal(daysFromCivil({ year, month, day }) * BigInt(86400)), seconds],
	})
}

function calendarValue(params: {
	primitive: string
	parts: CalendarParts
}): AtomicValue | undefined {
	const { primitive, parts } = params
	const year = parts.year === undefined ? REFERENCE_YEAR : BigInt(parts.year)
	const month = parts.month === undefined ? 1 : Number(parts.month)
	const day = parts.day === undefined ? 1 : Number(parts.day)
	const hour = Number(parts.hour ?? 0)
	const minute = Number(parts.minute ?? 0)
	const second = parseDecimal(parts.second ?? '0')
	if (year === BigInt(0) || month < 1 || month > 12 || second === undefined) return undefined
	if (day < 1 || day > daysInMonth({ year, month })) return undefined
	if (minute > 59 || second.unscaled >= BigInt(60) * BigInt(10) ** BigInt(second.scale))
		return undefined
	if (hour > 24 || (hour === 24 && (minute !== 0 || second.unscaled !== BigInt(0))))
		return undefined
	const offset = zoneOffsetMinutes(parts.zone)
	if (offset === null) return undefined
	const clock = wholeDecimal(BigInt(hour * 3_600 + minute * 60 - (offset ?? 0) * 60))
	return {
		kind: 'dateTime',
		primitive,
		seconds: instantOf({ year, month, day, seconds: addDecimals({ terms: [clock, second] }) }),
		zoned: offset !== undefined,
	}
}

/** The offset a zone names in minutes: `undefined` for none, `null` when it is out of range (past ±14:00). */
function zoneOffsetMinutes(zone: string | undefined): number | undefined | null {
	if (zone === undefined) return undefined
	if (zone === 'Z') return 0
	const hours = Number(zone.slice(1, 3))
	const minutes = Number(zone.slice(4, 6))
	if (minutes > 59 || hours > 14 || (hours === 14 && minutes !== 0)) return null
	return (zone.startsWith('-') ? -1 : 1) * (hours * 60 + minutes)
}

function isLeapYear(year: bigint): boolean {
	return (
		year % BigInt(4) === BigInt(0) &&
		(year % BigInt(100) !== BigInt(0) || year % BigInt(400) === BigInt(0))
	)
}

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil), in arbitrary precision. */
function daysFromCivil(params: { year: bigint; month: number; day: number }): bigint {
	const { month, day } = params
	const year = month <= 2 ? params.year - BigInt(1) : params.year
	const era = (year >= BigInt(0) ? year : year - BigInt(399)) / BigInt(400)
	const yearOfEra = year - era * BigInt(400)
	const dayOfYear = BigInt(
		Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1,
	)
	const dayOfEra =
		yearOfEra * BigInt(365) + yearOfEra / BigInt(4) - yearOfEra / BigInt(100) + dayOfYear
	return era * BigInt(146097) + dayOfEra - BigInt(719468)
}
