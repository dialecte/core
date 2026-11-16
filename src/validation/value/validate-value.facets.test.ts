import { pAndDefault, runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

describe('validateValue - facets', () => {
	runCases({
		'whiteSpace collapse on a string → the value collapsed before the facets': {
			type: { builtin: 'string', facets: { whiteSpace: 'collapse', length: 3 } },
			value: '  a b  ',
			expected: undefined,
		},
		'whiteSpace preserve on a token → no looser than the token, collapsed': {
			type: { builtin: 'token', facets: { whiteSpace: 'preserve', maxLength: 1 } },
			value: ' a ',
			expected: undefined,
		},
		'enumeration, a listed value → admitted': {
			type: { builtin: 'string', facets: { enumeration: ['x', 'y'] } },
			value: 'y',
			expected: undefined,
		},
		'enumeration, an unlisted value → enumeration': {
			type: { builtin: 'string', facets: { enumeration: ['x', 'y'] } },
			value: 'z',
			expected: { reason: 'enumeration', actual: 'z', expected: ['x', 'y'], facet: 'enumeration' },
		},
		'enumeration of decimals, the same value written longer → admitted': {
			type: { builtin: 'decimal', facets: { enumeration: ['1', '2.5'] } },
			value: '01.000',
			expected: undefined,
		},
		'enumeration of integers, a plus sign → admitted': {
			type: { builtin: 'integer', facets: { enumeration: ['5'] } },
			value: '+5',
			expected: undefined,
		},
		'enumeration of a union with a boolean member, one for true → admitted': {
			type: { union: [{ builtin: 'boolean' }], facets: { enumeration: ['true'] } },
			value: '1',
			expected: undefined,
		},
		'enumeration of doubles, not a number → admitted': {
			type: { builtin: 'double', facets: { enumeration: ['NaN', '0'] } },
			value: 'NaN',
			expected: undefined,
		},
		'enumeration of doubles, minus zero for zero → admitted': {
			type: { builtin: 'double', facets: { enumeration: ['NaN', '0'] } },
			value: '-0E0',
			expected: undefined,
		},
		'enumeration of dateTimes, the same instant in another offset → admitted': {
			type: { builtin: 'dateTime', facets: { enumeration: ['2026-10-21T17:00:00Z'] } },
			value: '2026-10-21T12:00:00-05:00',
			expected: undefined,
		},
		'enumeration of dateTimes, the same clock without an offset → enumeration': {
			type: { builtin: 'dateTime', facets: { enumeration: ['2026-10-21T17:00:00Z'] } },
			value: '2026-10-21T17:00:00',
			expected: {
				reason: 'enumeration',
				actual: '2026-10-21T17:00:00',
				expected: ['2026-10-21T17:00:00Z'],
				facet: 'enumeration',
			},
		},
		'enumeration of durations, a day as hours → admitted': {
			type: { builtin: 'duration', facets: { enumeration: ['P1D'] } },
			value: 'PT24H',
			expected: undefined,
		},
		'enumeration of hexBinary, other letter case → admitted': {
			type: { builtin: 'hexBinary', facets: { enumeration: ['0AFF'] } },
			value: '0aff',
			expected: undefined,
		},
		'enumeration of QNames, a prefix of the listed namespace → admitted': {
			type: { builtin: 'QName', facets: { enumeration: ['{urn:p}a', 'b'] } },
			value: 'p:a',
			namespaces: pAndDefault,
			expected: undefined,
		},
		'enumeration of QNames, unprefixed in the default namespace → enumeration': {
			type: { builtin: 'QName', facets: { enumeration: ['{urn:p}a', 'b'] } },
			value: 'b',
			namespaces: pAndDefault,
			expected: {
				reason: 'enumeration',
				actual: 'b',
				expected: ['{urn:p}a', 'b'],
				facet: 'enumeration',
			},
		},
		'enumeration of QNames, unprefixed with no default namespace → admitted': {
			type: { builtin: 'QName', facets: { enumeration: ['{urn:p}a', 'b'] } },
			value: 'b',
			expected: undefined,
		},
		'pattern, one pattern of each level → admitted': {
			type: { builtin: 'string', facets: { pattern: [['[a-z]+', '[0-9]+'], ['.{2}']] } },
			value: '12',
			expected: undefined,
		},
		'pattern, a value the second level refuses → pattern with that level': {
			type: { builtin: 'string', facets: { pattern: [['[a-z]+', '[0-9]+'], ['.{2}']] } },
			value: 'abc',
			expected: { reason: 'pattern', actual: 'abc', expected: ['.{2}'], facet: 'pattern' },
		},
		'pattern, matched on the normalized value → admitted': {
			type: { builtin: 'token', facets: { pattern: [['a b']] } },
			value: ' a   b ',
			expected: undefined,
		},
		'enumeration and pattern both refusing → enumeration first': {
			type: { builtin: 'string', facets: { enumeration: ['x'], pattern: [['[0-9]']] } },
			value: 'y',
			expected: { reason: 'enumeration', actual: 'y', expected: ['x'], facet: 'enumeration' },
		},
		'pattern and length both refusing → pattern first': {
			type: { builtin: 'string', facets: { pattern: [['[0-9]']], length: 1 } },
			value: 'ab',
			expected: { reason: 'pattern', actual: 'ab', expected: ['[0-9]'], facet: 'pattern' },
		},
		'length, a character outside the BMP counts once → admitted': {
			type: { builtin: 'string', facets: { length: 2 } },
			value: 'a\u{1D49C}',
			expected: undefined,
		},
		'length, one character short → length': {
			type: { builtin: 'string', facets: { length: 3 } },
			value: 'a\u{1D49C}',
			expected: { reason: 'length', actual: 'a\u{1D49C}', expected: 3, facet: 'length' },
		},
		'minLength, too short → length': {
			type: { builtin: 'string', facets: { minLength: 2 } },
			value: 'a',
			expected: { reason: 'length', actual: 'a', expected: 2, facet: 'minLength' },
		},
		'maxLength, too long → length': {
			type: { builtin: 'string', facets: { maxLength: 1 } },
			value: 'ab',
			expected: { reason: 'length', actual: 'ab', expected: 1, facet: 'maxLength' },
		},
		'length of hexBinary, two octets → admitted': {
			type: { builtin: 'hexBinary', facets: { length: 2 } },
			value: '0aff',
			expected: undefined,
		},
		'maxLength of base64Binary, four octets → length': {
			type: { builtin: 'base64Binary', facets: { maxLength: 3 } },
			value: 'QUJDRA==',
			expected: { reason: 'length', actual: 'QUJDRA==', expected: 3, facet: 'maxLength' },
		},
		'length of a QName → not counted, admitted': {
			type: { builtin: 'QName', facets: { length: 1 } },
			value: 'abc',
			expected: undefined,
		},
		'minInclusive of integers, the bound itself → admitted': {
			type: { builtin: 'integer', facets: { minInclusive: '0', maxInclusive: '100' } },
			value: '+000',
			expected: undefined,
		},
		'maxInclusive of integers, above → range': {
			type: { builtin: 'integer', facets: { minInclusive: '0', maxInclusive: '100' } },
			value: '101',
			expected: { reason: 'range', actual: '101', expected: '100', facet: 'maxInclusive' },
		},
		'minInclusive of integers, below → range': {
			type: { builtin: 'integer', facets: { minInclusive: '0', maxInclusive: '100' } },
			value: '-1',
			expected: { reason: 'range', actual: '-1', expected: '0', facet: 'minInclusive' },
		},
		'minExclusive of decimals, the bound written longer → range': {
			type: { builtin: 'decimal', facets: { minExclusive: '1', maxExclusive: '2.5' } },
			value: '1.000',
			expected: { reason: 'range', actual: '1.000', expected: '1', facet: 'minExclusive' },
		},
		'maxExclusive of decimals, just below → admitted': {
			type: { builtin: 'decimal', facets: { minExclusive: '1', maxExclusive: '2.5' } },
			value: '2.4999999999999999999',
			expected: undefined,
		},
		'maxExclusive of decimals, the bound → range': {
			type: { builtin: 'decimal', facets: { minExclusive: '1', maxExclusive: '2.5' } },
			value: '2.50',
			expected: { reason: 'range', actual: '2.50', expected: '2.5', facet: 'maxExclusive' },
		},
		'maxInclusive of doubles, infinity → range': {
			type: { builtin: 'double', facets: { maxInclusive: '1e308' } },
			value: 'INF',
			expected: { reason: 'range', actual: 'INF', expected: '1e308', facet: 'maxInclusive' },
		},
		'minInclusive of doubles, not a number → admitted (above every double)': {
			type: { builtin: 'double', facets: { minInclusive: '0' } },
			value: 'NaN',
			expected: undefined,
		},
		'minExclusive of doubles at infinity, not a number → admitted (above infinity)': {
			type: { builtin: 'double', facets: { minExclusive: 'INF' } },
			value: 'NaN',
			expected: undefined,
		},
		'maxInclusive of doubles at infinity, not a number → range': {
			type: { builtin: 'double', facets: { maxInclusive: 'INF' } },
			value: 'NaN',
			expected: { reason: 'range', actual: 'NaN', expected: 'INF', facet: 'maxInclusive' },
		},
		'maxInclusive of dateTimes, later in another offset → range': {
			type: { builtin: 'dateTime', facets: { maxInclusive: '2026-10-21T12:00:00Z' } },
			value: '2026-10-21T08:00:01-04:00',
			expected: {
				reason: 'range',
				actual: '2026-10-21T08:00:01-04:00',
				expected: '2026-10-21T12:00:00Z',
				facet: 'maxInclusive',
			},
		},
		'maxInclusive of dateTimes, unzoned within fourteen hours → range (indeterminate)': {
			type: { builtin: 'dateTime', facets: { maxInclusive: '2026-10-21T12:00:00Z' } },
			value: '2026-10-21T20:00:00',
			expected: {
				reason: 'range',
				actual: '2026-10-21T20:00:00',
				expected: '2026-10-21T12:00:00Z',
				facet: 'maxInclusive',
			},
		},
		'minInclusive of dateTimes, unzoned within fourteen hours → range (indeterminate)': {
			type: { builtin: 'dateTime', facets: { minInclusive: '2026-10-21T12:00:00Z' } },
			value: '2026-10-21T20:00:00',
			expected: {
				reason: 'range',
				actual: '2026-10-21T20:00:00',
				expected: '2026-10-21T12:00:00Z',
				facet: 'minInclusive',
			},
		},
		'minInclusive of dateTimes, unzoned beyond fourteen hours later → admitted': {
			type: { builtin: 'dateTime', facets: { minInclusive: '2026-10-21T12:00:00Z' } },
			value: '2026-10-22T02:00:01',
			expected: undefined,
		},
		'maxInclusive of dateTimes, unzoned beyond fourteen hours → range': {
			type: { builtin: 'dateTime', facets: { maxInclusive: '2026-10-21T12:00:00Z' } },
			value: '2026-10-22T02:00:01',
			expected: {
				reason: 'range',
				actual: '2026-10-22T02:00:01',
				expected: '2026-10-21T12:00:00Z',
				facet: 'maxInclusive',
			},
		},
		'minInclusive of dates, the day after → admitted': {
			type: { builtin: 'date', facets: { minInclusive: '2026-02-28' } },
			value: '2026-03-01',
			expected: undefined,
		},
		'minInclusive of gYears, earlier → range': {
			type: { builtin: 'gYear', facets: { minInclusive: '2000' } },
			value: '-2000',
			expected: { reason: 'range', actual: '-2000', expected: '2000', facet: 'minInclusive' },
		},
		'maxInclusive of times, a second past → range': {
			type: { builtin: 'time', facets: { maxInclusive: '12:00:00' } },
			value: '12:00:01',
			expected: {
				reason: 'range',
				actual: '12:00:01',
				expected: '12:00:00',
				facet: 'maxInclusive',
			},
		},
		'maxInclusive of durations, a month against thirty days → range (indeterminate)': {
			type: { builtin: 'duration', facets: { maxInclusive: 'P30D' } },
			value: 'P1M',
			expected: { reason: 'range', actual: 'P1M', expected: 'P30D', facet: 'maxInclusive' },
		},
		'minInclusive of durations, a month against thirty days → range (indeterminate)': {
			type: { builtin: 'duration', facets: { minInclusive: 'P30D' } },
			value: 'P1M',
			expected: { reason: 'range', actual: 'P1M', expected: 'P30D', facet: 'minInclusive' },
		},
		'minInclusive of durations, a month against twenty-seven days → admitted': {
			type: { builtin: 'duration', facets: { minInclusive: 'P27D' } },
			value: 'P1M',
			expected: undefined,
		},
		'maxInclusive of durations, a month against twenty-seven days → range': {
			type: { builtin: 'duration', facets: { maxInclusive: 'P27D' } },
			value: 'P1M',
			expected: { reason: 'range', actual: 'P1M', expected: 'P27D', facet: 'maxInclusive' },
		},
		'totalDigits, leading and trailing zeros not counted → admitted': {
			type: { builtin: 'decimal', facets: { totalDigits: 3, fractionDigits: 2 } },
			value: '000012.300',
			expected: undefined,
		},
		'totalDigits, one digit too many → digits': {
			type: { builtin: 'decimal', facets: { totalDigits: 3, fractionDigits: 2 } },
			value: '1234',
			expected: { reason: 'digits', actual: '1234', expected: 3, facet: 'totalDigits' },
		},
		'totalDigits, zeros after the point before a digit count → digits': {
			type: { builtin: 'decimal', facets: { totalDigits: 3 } },
			value: '0.0001',
			expected: { reason: 'digits', actual: '0.0001', expected: 3, facet: 'totalDigits' },
		},
		'fractionDigits, a trailing zero not counted → admitted': {
			type: { builtin: 'decimal', facets: { fractionDigits: 1 } },
			value: '1.50',
			expected: undefined,
		},
		'fractionDigits, one digit too many → digits': {
			type: { builtin: 'decimal', facets: { fractionDigits: 1 } },
			value: '1.05',
			expected: { reason: 'digits', actual: '1.05', expected: 1, facet: 'fractionDigits' },
		},
		'fractionDigits zero on an integer → admitted': {
			type: { builtin: 'integer', facets: { fractionDigits: 0, totalDigits: 2 } },
			value: '-0099',
			expected: undefined,
		},
	})
})
