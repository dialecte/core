/** The lexical forms of the built-ins core reads with a regular expression. */

export const DECIMAL_LEXICAL = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/
export const INTEGER_LEXICAL = /^[+-]?[0-9]+$/

export const FLOAT_LEXICAL =
	/^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|-?INF|NaN)$/

/** A URI scheme (RFC 2396): a letter, then letters, digits, `+`, `-` or `.`. */
export const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/

/** The first segment of a URI reference: what precedes the first `/`, `?` or `#`. */
export const URI_FIRST_SEGMENT = /^[^/?#]*/

export const HEX_BINARY_LEXICAL = /^(?:[0-9a-fA-F]{2})*$/
/** Groups of four, the last one padded: one `=` after a character whose two low bits are clear, two after one whose four are. */
export const BASE64_BINARY_LEXICAL =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=|[A-Za-z0-9+/][AQgw]==)?$/

const YEAR = '(?<year>-?(?:[1-9][0-9]{3,}|0[0-9]{3}))'
const MONTH = '(?<month>[0-9]{2})'
const DAY = '(?<day>[0-9]{2})'
const TIME = '(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2}(?:\\.[0-9]+)?)'
const ZONE = '(?<zone>Z|[+-][0-9]{2}:[0-9]{2})?'

function calendarForm(source: string): RegExp {
	return new RegExp(`^${source}${ZONE}$`)
}

/** Each calendar built-in's lexical form; the parts it does not name are read from a leap year's first day. */
export const CALENDAR_FORMS: Readonly<Record<string, RegExp>> = {
	dateTime: calendarForm(`${YEAR}-${MONTH}-${DAY}T${TIME}`),
	date: calendarForm(`${YEAR}-${MONTH}-${DAY}`),
	time: calendarForm(TIME),
	gYearMonth: calendarForm(`${YEAR}-${MONTH}`),
	gYear: calendarForm(YEAR),
	gMonthDay: calendarForm(`--${MONTH}-${DAY}`),
	gMonth: calendarForm(`--${MONTH}`),
	gDay: calendarForm(`---${DAY}`),
}
/** The year a calendar value that names none is read in: a leap year, so 29 February has a place. */
export const REFERENCE_YEAR = BigInt(1972)

export const DURATION_LEXICAL =
	/^(?<negative>-)?P(?:(?<years>[0-9]+)Y)?(?:(?<months>[0-9]+)M)?(?:(?<days>[0-9]+)D)?(?<time>T(?:(?<hours>[0-9]+)H)?(?:(?<minutes>[0-9]+)M)?(?:(?<seconds>[0-9]+(?:\.[0-9]*)?|\.[0-9]+)S)?)?$/
