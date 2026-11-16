import { runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

// The rows of the oracle exceptions: where core keeps the XSD rule over the reference parser's verdict.
describe('validateValue - the oracle exceptions', () => {
	runCases({
		'1: the empty value under NMTOKENS → length (minLength 1), the parser admits it': {
			type: { builtin: 'NMTOKENS' },
			value: '',
			expected: { reason: 'length', actual: '', expected: 1, facet: 'minLength' },
		},
		'2: a blank value under NMTOKENS → length on the collapsed value, the parser admits it': {
			type: { builtin: 'NMTOKENS' },
			value: '  ',
			expected: { reason: 'length', actual: '', expected: 1, facet: 'minLength' },
		},
		'3: the empty value under IDREFS → length (minLength 1), the parser admits it': {
			type: { builtin: 'IDREFS' },
			value: '',
			expected: { reason: 'length', actual: '', expected: 1, facet: 'minLength' },
		},
		'4: an unclosed IPv6 host under anyURI → admitted, the parser refuses it': {
			type: { builtin: 'anyURI' },
			value: 'http://[::1',
			expected: undefined,
		},
		'5: an unzoned dateTime within fourteen hours of a zoned bound, at the boundary → range (indeterminate)':
			{
				type: { builtin: 'dateTime', facets: { minInclusive: '2026-10-21T12:00:00Z' } },
				value: '2026-10-22T02:00:00',
				expected: {
					reason: 'range',
					actual: '2026-10-22T02:00:00',
					expected: '2026-10-21T12:00:00Z',
					facet: 'minInclusive',
				},
			},
		'6: a name under ENTITY → admitted (no DTD is kept to name the entities), the parser refuses it':
			{
				type: { builtin: 'ENTITY' },
				value: 'logo',
				expected: undefined,
			},
		'7: a date under base64Binary → datatype, the parser skips the characters outside the alphabet and admits it':
			{
				type: { builtin: 'base64Binary' },
				value: '2024-01-01',
				expected: { reason: 'datatype', actual: '2024-01-01', expected: 'base64Binary' },
			},
		'8: a year past 32 bits under gYear → admitted (a year has no bound), the parser refuses it': {
			type: { builtin: 'gYear' },
			value: '4294967296',
			expected: undefined,
		},
		'9: a bracket outside an IP literal under anyURI → admitted (any string a URI once escaped), the parser refuses it':
			{
				type: { builtin: 'anyURI' },
				value: '[',
				expected: undefined,
			},
		'10: an exponent without digits under float → datatype, the parser admits it': {
			type: { builtin: 'float' },
			value: '1e',
			expected: { reason: 'datatype', actual: '1e', expected: 'float' },
		},
		'11: an exponent without digits under double → datatype, the parser admits it': {
			type: { builtin: 'double' },
			value: '1e',
			expected: { reason: 'datatype', actual: '1e', expected: 'double' },
		},
	})
})
