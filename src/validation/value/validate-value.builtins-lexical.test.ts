import { runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

describe('validateValue - built-ins, numbers, strings, names and URIs', () => {
	runCases({
		'integer, letters → datatype': {
			type: { builtin: 'integer' },
			value: 'abc',
			expected: { reason: 'datatype', actual: 'abc', expected: 'integer' },
		},
		'integer, blanks around → collapsed, admitted': {
			type: { builtin: 'integer' },
			value: ' 42\n',
			expected: undefined,
		},
		'integer, blanks inside → datatype on the collapsed value': {
			type: { builtin: 'integer' },
			value: ' 4\t\n 2 ',
			expected: { reason: 'datatype', actual: '4 2', expected: 'integer' },
		},
		'decimal, fraction with trailing zero → admitted': {
			type: { builtin: 'decimal' },
			value: '1.50',
			expected: undefined,
		},
		'decimal, leading point → admitted': {
			type: { builtin: 'decimal' },
			value: '-.5',
			expected: undefined,
		},
		'decimal, trailing point → admitted': {
			type: { builtin: 'decimal' },
			value: '5.',
			expected: undefined,
		},
		'decimal, a point alone → datatype': {
			type: { builtin: 'decimal' },
			value: '.',
			expected: { reason: 'datatype', actual: '.', expected: 'decimal' },
		},
		'decimal, two points → datatype': {
			type: { builtin: 'decimal' },
			value: '1.2.3',
			expected: { reason: 'datatype', actual: '1.2.3', expected: 'decimal' },
		},
		'decimal, exponent → datatype': {
			type: { builtin: 'decimal' },
			value: '1e3',
			expected: { reason: 'datatype', actual: '1e3', expected: 'decimal' },
		},
		'integer, plus sign → admitted': {
			type: { builtin: 'integer' },
			value: '+5',
			expected: undefined,
		},
		'integer, fraction → datatype': {
			type: { builtin: 'integer' },
			value: '1.0',
			expected: { reason: 'datatype', actual: '1.0', expected: 'integer' },
		},
		'nonPositiveInteger, minus zero → admitted': {
			type: { builtin: 'nonPositiveInteger' },
			value: '-0',
			expected: undefined,
		},
		'nonPositiveInteger, one → datatype': {
			type: { builtin: 'nonPositiveInteger' },
			value: '1',
			expected: { reason: 'datatype', actual: '1', expected: 'nonPositiveInteger' },
		},
		'negativeInteger, minus one → admitted': {
			type: { builtin: 'negativeInteger' },
			value: '-1',
			expected: undefined,
		},
		'negativeInteger, zero → datatype': {
			type: { builtin: 'negativeInteger' },
			value: '0',
			expected: { reason: 'datatype', actual: '0', expected: 'negativeInteger' },
		},
		'nonNegativeInteger, minus zero → admitted': {
			type: { builtin: 'nonNegativeInteger' },
			value: '-0',
			expected: undefined,
		},
		'nonNegativeInteger, minus one → datatype': {
			type: { builtin: 'nonNegativeInteger' },
			value: '-1',
			expected: { reason: 'datatype', actual: '-1', expected: 'nonNegativeInteger' },
		},
		'positiveInteger, one → admitted': {
			type: { builtin: 'positiveInteger' },
			value: '1',
			expected: undefined,
		},
		'positiveInteger, zero → datatype': {
			type: { builtin: 'positiveInteger' },
			value: '0',
			expected: { reason: 'datatype', actual: '0', expected: 'positiveInteger' },
		},
		'long, its maximum → admitted': {
			type: { builtin: 'long' },
			value: '9223372036854775807',
			expected: undefined,
		},
		'long, above its maximum → datatype': {
			type: { builtin: 'long' },
			value: '9223372036854775808',
			expected: { reason: 'datatype', actual: '9223372036854775808', expected: 'long' },
		},
		'long, below its minimum → datatype': {
			type: { builtin: 'long' },
			value: '-9223372036854775809',
			expected: { reason: 'datatype', actual: '-9223372036854775809', expected: 'long' },
		},
		'int, its minimum → admitted': {
			type: { builtin: 'int' },
			value: '-2147483648',
			expected: undefined,
		},
		'int, above its maximum → datatype': {
			type: { builtin: 'int' },
			value: '2147483648',
			expected: { reason: 'datatype', actual: '2147483648', expected: 'int' },
		},
		'short, its minimum → admitted': {
			type: { builtin: 'short' },
			value: '-32768',
			expected: undefined,
		},
		'short, above its maximum → datatype': {
			type: { builtin: 'short' },
			value: '32768',
			expected: { reason: 'datatype', actual: '32768', expected: 'short' },
		},
		'byte, its minimum → admitted': {
			type: { builtin: 'byte' },
			value: '-128',
			expected: undefined,
		},
		'byte, above its maximum → datatype': {
			type: { builtin: 'byte' },
			value: '128',
			expected: { reason: 'datatype', actual: '128', expected: 'byte' },
		},
		'unsignedLong, its maximum → admitted': {
			type: { builtin: 'unsignedLong' },
			value: '18446744073709551615',
			expected: undefined,
		},
		'unsignedLong, above its maximum → datatype': {
			type: { builtin: 'unsignedLong' },
			value: '18446744073709551616',
			expected: { reason: 'datatype', actual: '18446744073709551616', expected: 'unsignedLong' },
		},
		'unsignedLong, minus one → datatype': {
			type: { builtin: 'unsignedLong' },
			value: '-1',
			expected: { reason: 'datatype', actual: '-1', expected: 'unsignedLong' },
		},
		'unsignedInt, above its maximum → datatype': {
			type: { builtin: 'unsignedInt' },
			value: '4294967296',
			expected: { reason: 'datatype', actual: '4294967296', expected: 'unsignedInt' },
		},
		'unsignedShort, above its maximum → datatype': {
			type: { builtin: 'unsignedShort' },
			value: '65536',
			expected: { reason: 'datatype', actual: '65536', expected: 'unsignedShort' },
		},
		'unsignedByte, its maximum with leading zeros → admitted': {
			type: { builtin: 'unsignedByte' },
			value: '00255',
			expected: undefined,
		},
		'unsignedByte, above its maximum → datatype': {
			type: { builtin: 'unsignedByte' },
			value: '256',
			expected: { reason: 'datatype', actual: '256', expected: 'unsignedByte' },
		},
		'string, blanks kept → admitted as written': {
			type: { builtin: 'string' },
			value: ' a\tb ',
			expected: undefined,
		},
		'string, a control character → datatype': {
			type: { builtin: 'string' },
			value: 'a\u0001b',
			expected: { reason: 'datatype', actual: 'a\u0001b', expected: 'string' },
		},
		'string, a lone surrogate → datatype': {
			type: { builtin: 'string' },
			value: 'a\uD800b',
			expected: { reason: 'datatype', actual: 'a\uD800b', expected: 'string' },
		},
		'normalizedString, tab → replaced, admitted': {
			type: { builtin: 'normalizedString' },
			value: 'a\tb',
			expected: undefined,
		},
		'normalizedString, a control character → datatype on the replaced value': {
			type: { builtin: 'normalizedString' },
			value: 'a\t\u0001',
			expected: { reason: 'datatype', actual: 'a \u0001', expected: 'normalizedString' },
		},
		'token, blanks → collapsed, admitted': {
			type: { builtin: 'token' },
			value: '  a \n b ',
			expected: undefined,
		},
		'token, a control character → datatype': {
			type: { builtin: 'token' },
			value: ' a\u0007 ',
			expected: { reason: 'datatype', actual: 'a\u0007', expected: 'token' },
		},
		'IDREF, a name → admitted': { type: { builtin: 'IDREF' }, value: 'é1', expected: undefined },
		'ENTITY, a name → admitted': {
			type: { builtin: 'ENTITY' },
			value: 'logo',
			expected: undefined,
		},
		'unsignedInt, its maximum → admitted': {
			type: { builtin: 'unsignedInt' },
			value: '4294967295',
			expected: undefined,
		},
		'unsignedShort, its maximum → admitted': {
			type: { builtin: 'unsignedShort' },
			value: '65535',
			expected: undefined,
		},
		'language, region subtag → admitted': {
			type: { builtin: 'language' },
			value: 'en-GB',
			expected: undefined,
		},
		'language, a subtag of nine letters → datatype': {
			type: { builtin: 'language' },
			value: 'en-abcdefghi',
			expected: { reason: 'datatype', actual: 'en-abcdefghi', expected: 'language' },
		},
		'Name, an accented letter first → admitted': {
			type: { builtin: 'Name' },
			value: 'été:x',
			expected: undefined,
		},
		'Name, a digit first → datatype': {
			type: { builtin: 'Name' },
			value: '1a',
			expected: { reason: 'datatype', actual: '1a', expected: 'Name' },
		},
		'Name, a letter outside the BMP → datatype': {
			type: { builtin: 'Name' },
			value: 'a\u{1D49C}',
			expected: { reason: 'datatype', actual: 'a\u{1D49C}', expected: 'Name' },
		},
		'NCName, an accented name → admitted': {
			type: { builtin: 'NCName' },
			value: '_é-1.x',
			expected: undefined,
		},
		'NCName, a colon → datatype': {
			type: { builtin: 'NCName' },
			value: 'a:b',
			expected: { reason: 'datatype', actual: 'a:b', expected: 'NCName' },
		},
		'NMTOKEN, a digit first → admitted': {
			type: { builtin: 'NMTOKEN' },
			value: '-1a',
			expected: undefined,
		},
		'NMTOKEN, a space inside → datatype': {
			type: { builtin: 'NMTOKEN' },
			value: 'a b',
			expected: { reason: 'datatype', actual: 'a b', expected: 'NMTOKEN' },
		},
		'ID, a name → admitted': { type: { builtin: 'ID' }, value: 'id1', expected: undefined },
		'ID, a colon → datatype': {
			type: { builtin: 'ID' },
			value: 'a:b',
			expected: { reason: 'datatype', actual: 'a:b', expected: 'ID' },
		},
		'IDREF, a digit first → datatype': {
			type: { builtin: 'IDREF' },
			value: '1a',
			expected: { reason: 'datatype', actual: '1a', expected: 'IDREF' },
		},
		'ENTITY, a digit first → datatype': {
			type: { builtin: 'ENTITY' },
			value: '1a',
			expected: { reason: 'datatype', actual: '1a', expected: 'ENTITY' },
		},
		'anyURI, a relative reference → admitted': {
			type: { builtin: 'anyURI' },
			value: '../a b/c?d#e',
			expected: undefined,
		},
		'anyURI, a broken percent escape → datatype': {
			type: { builtin: 'anyURI' },
			value: 'http://a/%zz',
			expected: { reason: 'datatype', actual: 'http://a/%zz', expected: 'anyURI' },
		},
		'anyURI, two fragments → datatype': {
			type: { builtin: 'anyURI' },
			value: 'a#b#c',
			expected: { reason: 'datatype', actual: 'a#b#c', expected: 'anyURI' },
		},
		'anyURI, a colon with no scheme before it (:a) → datatype': {
			type: { builtin: 'anyURI' },
			value: ':a',
			expected: { reason: 'datatype', actual: ':a', expected: 'anyURI' },
		},
		'anyURI, a scheme starting with a digit (1:a) → datatype': {
			type: { builtin: 'anyURI' },
			value: '1:a',
			expected: { reason: 'datatype', actual: '1:a', expected: 'anyURI' },
		},
		'anyURI, a scheme starting with a hyphen (-a:b) → datatype': {
			type: { builtin: 'anyURI' },
			value: '-a:b',
			expected: { reason: 'datatype', actual: '-a:b', expected: 'anyURI' },
		},
		'anyURI, a space in the scheme (a b:c) → datatype': {
			type: { builtin: 'anyURI' },
			value: 'a b:c',
			expected: { reason: 'datatype', actual: 'a b:c', expected: 'anyURI' },
		},
		'anyURI, a percent escape in the scheme (%41:b) → datatype': {
			type: { builtin: 'anyURI' },
			value: '%41:b',
			expected: { reason: 'datatype', actual: '%41:b', expected: 'anyURI' },
		},
		'anyURI, a time, digits before the colon (12:00) → datatype': {
			type: { builtin: 'anyURI' },
			value: '12:00',
			expected: { reason: 'datatype', actual: '12:00', expected: 'anyURI' },
		},
		'anyURI, a date-time, digits before the first colon (2024-01-01T00:00:00) → datatype': {
			type: { builtin: 'anyURI' },
			value: '2024-01-01T00:00:00',
			expected: { reason: 'datatype', actual: '2024-01-01T00:00:00', expected: 'anyURI' },
		},
		'anyURI, a one-letter scheme (a:b) → admitted': {
			type: { builtin: 'anyURI' },
			value: 'a:b',
			expected: undefined,
		},
		'anyURI, a urn (urn:x) → admitted': {
			type: { builtin: 'anyURI' },
			value: 'urn:x',
			expected: undefined,
		},
		'anyURI, an http URI (http://h/p) → admitted': {
			type: { builtin: 'anyURI' },
			value: 'http://h/p',
			expected: undefined,
		},
		'anyURI, a colon after the first segment (rel/a:b) → admitted': {
			type: { builtin: 'anyURI' },
			value: 'rel/a:b',
			expected: undefined,
		},
	})
})
