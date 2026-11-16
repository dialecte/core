import { runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

describe('validateValue - built-ins, booleans, floats, binaries, dates and durations', () => {
	runCases({
		'boolean, one → admitted': { type: { builtin: 'boolean' }, value: '1', expected: undefined },
		'boolean, upper case → datatype': {
			type: { builtin: 'boolean' },
			value: 'TRUE',
			expected: { reason: 'datatype', actual: 'TRUE', expected: 'boolean' },
		},
		'anySimpleType, any characters → admitted': {
			type: { builtin: 'anySimpleType' },
			value: ' <a> & b ',
			expected: undefined,
		},
		'float, exponent → admitted': {
			type: { builtin: 'float' },
			value: '1.5e3',
			expected: undefined,
		},
		'float, minus infinity → admitted': {
			type: { builtin: 'float' },
			value: '-INF',
			expected: undefined,
		},
		'float, not a number → admitted': {
			type: { builtin: 'float' },
			value: 'NaN',
			expected: undefined,
		},
		'float, plus infinity → datatype': {
			type: { builtin: 'float' },
			value: '+INF',
			expected: { reason: 'datatype', actual: '+INF', expected: 'float' },
		},
		'float, lower-case infinity → datatype': {
			type: { builtin: 'float' },
			value: 'inf',
			expected: { reason: 'datatype', actual: 'inf', expected: 'float' },
		},
		'float, an exponent without digits → datatype': {
			type: { builtin: 'float' },
			value: '1e',
			expected: { reason: 'datatype', actual: '1e', expected: 'float' },
		},
		'double, signed exponent and leading point → admitted': {
			type: { builtin: 'double' },
			value: '-.5E-3',
			expected: undefined,
		},
		'double, a decimal comma → datatype': {
			type: { builtin: 'double' },
			value: '1,5',
			expected: { reason: 'datatype', actual: '1,5', expected: 'double' },
		},
		'hexBinary, mixed case → admitted': {
			type: { builtin: 'hexBinary' },
			value: '0aF1',
			expected: undefined,
		},
		'hexBinary, empty → admitted': {
			type: { builtin: 'hexBinary' },
			value: '',
			expected: undefined,
		},
		'hexBinary, an odd count of digits → datatype': {
			type: { builtin: 'hexBinary' },
			value: 'abc',
			expected: { reason: 'datatype', actual: 'abc', expected: 'hexBinary' },
		},
		'hexBinary, a letter out of range → datatype': {
			type: { builtin: 'hexBinary' },
			value: '0g',
			expected: { reason: 'datatype', actual: '0g', expected: 'hexBinary' },
		},
		'base64Binary, one padding character → admitted': {
			type: { builtin: 'base64Binary' },
			value: 'QUI=',
			expected: undefined,
		},
		'base64Binary, spaces between characters → admitted': {
			type: { builtin: 'base64Binary' },
			value: 'QU JD',
			expected: undefined,
		},
		'base64Binary, padding bits set → datatype': {
			type: { builtin: 'base64Binary' },
			value: 'QR==',
			expected: { reason: 'datatype', actual: 'QR==', expected: 'base64Binary' },
		},
		'base64Binary, a missing character → datatype': {
			type: { builtin: 'base64Binary' },
			value: 'QUJ',
			expected: { reason: 'datatype', actual: 'QUJ', expected: 'base64Binary' },
		},
		'base64Binary, three padding characters → datatype': {
			type: { builtin: 'base64Binary' },
			value: 'Q===',
			expected: { reason: 'datatype', actual: 'Q===', expected: 'base64Binary' },
		},
		'dateTime, UTC → admitted': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T10:00:00Z',
			expected: undefined,
		},
		'dateTime, fraction and the largest offset → admitted': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T10:00:00.125+14:00',
			expected: undefined,
		},
		'dateTime, end of day → admitted': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T24:00:00',
			expected: undefined,
		},
		'dateTime, past the end of day → datatype': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T24:00:01',
			expected: { reason: 'datatype', actual: '2026-10-21T24:00:01', expected: 'dateTime' },
		},
		'dateTime, 29 February of a leap year → admitted': {
			type: { builtin: 'dateTime' },
			value: '2024-02-29T00:00:00',
			expected: undefined,
		},
		'dateTime, 29 February of another year → datatype': {
			type: { builtin: 'dateTime' },
			value: '2026-02-29T00:00:00',
			expected: { reason: 'datatype', actual: '2026-02-29T00:00:00', expected: 'dateTime' },
		},
		'dateTime, year zero → datatype': {
			type: { builtin: 'dateTime' },
			value: '0000-01-01T00:00:00',
			expected: { reason: 'datatype', actual: '0000-01-01T00:00:00', expected: 'dateTime' },
		},
		'dateTime, a year before year one → admitted': {
			type: { builtin: 'dateTime' },
			value: '-0001-01-01T00:00:00',
			expected: undefined,
		},
		'dateTime, a five-digit year → admitted': {
			type: { builtin: 'dateTime' },
			value: '12026-01-01T00:00:00',
			expected: undefined,
		},
		'dateTime, a five-digit year with a leading zero → datatype': {
			type: { builtin: 'dateTime' },
			value: '02026-01-01T00:00:00',
			expected: { reason: 'datatype', actual: '02026-01-01T00:00:00', expected: 'dateTime' },
		},
		'dateTime, an offset past fourteen hours → datatype': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T10:00:00+14:30',
			expected: { reason: 'datatype', actual: '2026-10-21T10:00:00+14:30', expected: 'dateTime' },
		},
		'dateTime, no seconds → datatype': {
			type: { builtin: 'dateTime' },
			value: '2026-10-21T10:00',
			expected: { reason: 'datatype', actual: '2026-10-21T10:00', expected: 'dateTime' },
		},
		'date, with an offset → admitted': {
			type: { builtin: 'date' },
			value: '2026-10-21-05:00',
			expected: undefined,
		},
		'date, 31 April → datatype': {
			type: { builtin: 'date' },
			value: '2026-04-31',
			expected: { reason: 'datatype', actual: '2026-04-31', expected: 'date' },
		},
		'date, month thirteen → datatype': {
			type: { builtin: 'date' },
			value: '2026-13-01',
			expected: { reason: 'datatype', actual: '2026-13-01', expected: 'date' },
		},
		'time, fraction and offset → admitted': {
			type: { builtin: 'time' },
			value: '23:59:59.5-05:00',
			expected: undefined,
		},
		'time, minute sixty → datatype': {
			type: { builtin: 'time' },
			value: '23:60:00',
			expected: { reason: 'datatype', actual: '23:60:00', expected: 'time' },
		},
		'gYear, four digits → admitted': {
			type: { builtin: 'gYear' },
			value: '2026',
			expected: undefined,
		},
		'gYear, two digits → datatype': {
			type: { builtin: 'gYear' },
			value: '26',
			expected: { reason: 'datatype', actual: '26', expected: 'gYear' },
		},
		'gYearMonth, two-digit month → admitted': {
			type: { builtin: 'gYearMonth' },
			value: '2026-10Z',
			expected: undefined,
		},
		'gYearMonth, one-digit month → datatype': {
			type: { builtin: 'gYearMonth' },
			value: '2026-1',
			expected: { reason: 'datatype', actual: '2026-1', expected: 'gYearMonth' },
		},
		'gMonth, October → admitted': {
			type: { builtin: 'gMonth' },
			value: '--10',
			expected: undefined,
		},
		'gMonth, the old trailing dashes → datatype': {
			type: { builtin: 'gMonth' },
			value: '--10--',
			expected: { reason: 'datatype', actual: '--10--', expected: 'gMonth' },
		},
		'gMonthDay, 29 February → admitted': {
			type: { builtin: 'gMonthDay' },
			value: '--02-29',
			expected: undefined,
		},
		'gMonthDay, 31 April → datatype': {
			type: { builtin: 'gMonthDay' },
			value: '--04-31',
			expected: { reason: 'datatype', actual: '--04-31', expected: 'gMonthDay' },
		},
		'gDay, the thirty-first → admitted': {
			type: { builtin: 'gDay' },
			value: '---31',
			expected: undefined,
		},
		'gDay, the thirty-second → datatype': {
			type: { builtin: 'gDay' },
			value: '---32',
			expected: { reason: 'datatype', actual: '---32', expected: 'gDay' },
		},
		'duration, every part → admitted': {
			type: { builtin: 'duration' },
			value: 'P1Y2M3DT4H5M6.7S',
			expected: undefined,
		},
		'duration, negative seconds with a leading point → admitted': {
			type: { builtin: 'duration' },
			value: '-PT.5S',
			expected: undefined,
		},
		'duration, no part → datatype': {
			type: { builtin: 'duration' },
			value: 'P',
			expected: { reason: 'datatype', actual: 'P', expected: 'duration' },
		},
		'duration, a time mark without a time part → datatype': {
			type: { builtin: 'duration' },
			value: 'P1YT',
			expected: { reason: 'datatype', actual: 'P1YT', expected: 'duration' },
		},
		'duration, a signed part → datatype': {
			type: { builtin: 'duration' },
			value: 'P-1Y',
			expected: { reason: 'datatype', actual: 'P-1Y', expected: 'duration' },
		},
		'duration, a fraction of years → datatype': {
			type: { builtin: 'duration' },
			value: 'P1.5Y',
			expected: { reason: 'datatype', actual: 'P1.5Y', expected: 'duration' },
		},
	})
})
