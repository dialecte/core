import { runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

import type { DataType } from '@/types'

describe('validateValue - list built-ins', () => {
	runCases({
		'NMTOKENS, two tokens → admitted': {
			type: { builtin: 'NMTOKENS' },
			value: ' a  -b ',
			expected: undefined,
		},
		'NMTOKENS, empty → length (one at least)': {
			type: { builtin: 'NMTOKENS' },
			value: '  ',
			expected: { reason: 'length', actual: '', expected: 1, facet: 'minLength' },
		},
		'NMTOKENS, a token with a comma → datatype of the token': {
			type: { builtin: 'NMTOKENS' },
			value: 'a b,c',
			expected: { reason: 'datatype', actual: 'b,c', expected: 'NMTOKEN' },
		},
		'IDREFS, two names → admitted': {
			type: { builtin: 'IDREFS' },
			value: 'a b',
			expected: undefined,
		},
		'IDREFS, a digit first → datatype of the name': {
			type: { builtin: 'IDREFS' },
			value: 'a 1b',
			expected: { reason: 'datatype', actual: '1b', expected: 'IDREF' },
		},
		'ENTITIES, two names → admitted': {
			type: { builtin: 'ENTITIES' },
			value: 'a b',
			expected: undefined,
		},
		'ENTITIES, a colon → datatype of the name': {
			type: { builtin: 'ENTITIES' },
			value: 'a:b',
			expected: { reason: 'datatype', actual: 'a:b', expected: 'ENTITY' },
		},
		'ENTITIES, more than its maxLength → length': {
			type: { builtin: 'ENTITIES', facets: { maxLength: 1 } },
			value: 'a b',
			expected: { reason: 'length', actual: 'a b', expected: 1, facet: 'maxLength' },
		},
	})
})
describe('validateValue - lists', () => {
	const integers: DataType = { list: { builtin: 'integer', facets: { maxInclusive: '9' } } }
	runCases({
		'list of integers, blanks around and between → admitted': {
			type: integers,
			value: ' 1 \n 2  3 ',
			expected: undefined,
		},
		'list of integers, empty → admitted': { type: integers, value: '', expected: undefined },
		'list of integers, an item not an integer → datatype of the item': {
			type: integers,
			value: '1 x 3',
			expected: { reason: 'datatype', actual: 'x', expected: 'integer' },
		},
		'list of integers, an item above its maximum → range of the item': {
			type: integers,
			value: '1 10',
			expected: { reason: 'range', actual: '10', expected: '9', facet: 'maxInclusive' },
		},
		'list with a length, three items for two → length on the item count': {
			type: { ...integers, facets: { length: 2 } },
			value: '1  2 3',
			expected: { reason: 'length', actual: '1 2 3', expected: 2, facet: 'length' },
		},
		'list with an enumeration, the same items written otherwise → admitted': {
			type: { ...integers, facets: { enumeration: ['1 2'] } },
			value: '01 +2',
			expected: undefined,
		},
		'list with an enumeration, the items in another order → enumeration': {
			type: { ...integers, facets: { enumeration: ['1 2'] } },
			value: '2 1',
			expected: { reason: 'enumeration', actual: '2 1', expected: ['1 2'], facet: 'enumeration' },
		},
		'list with a pattern, on the collapsed list → pattern': {
			type: { ...integers, facets: { pattern: [['[0-9]( [0-9])?']] } },
			value: '1 2 3',
			expected: {
				reason: 'pattern',
				actual: '1 2 3',
				expected: ['[0-9]( [0-9])?'],
				facet: 'pattern',
			},
		},
	})
})

describe('validateValue - unions', () => {
	const integerOrAuto: DataType = {
		union: [
			{ builtin: 'integer', facets: { maxInclusive: '10' } },
			{ builtin: 'token', facets: { enumeration: ['auto'] } },
		],
	}
	runCases({
		'union, a value of the first member → admitted': {
			type: integerOrAuto,
			value: ' 7 ',
			expected: undefined,
		},
		'union, a value of the second member only → admitted': {
			type: integerOrAuto,
			value: 'auto',
			expected: undefined,
		},
		'union, a value no member admits → datatype with the members': {
			type: integerOrAuto,
			value: '11',
			expected: { reason: 'datatype', actual: '11', expected: ['integer', 'token'] },
		},
		'union, the first member refusing on a facet → the next member admits': {
			type: {
				union: [{ builtin: 'integer', facets: { maxInclusive: '10' } }, { builtin: 'string' }],
			},
			value: '20',
			expected: undefined,
		},
		'union with an enumeration, the value of the accepting member → admitted': {
			type: {
				union: [{ builtin: 'integer' }, { builtin: 'string' }],
				facets: { enumeration: ['1', 'a'] },
			},
			value: '01',
			expected: undefined,
		},
		'union with an enumeration, an unlisted value → enumeration': {
			type: {
				union: [{ builtin: 'integer' }, { builtin: 'string' }],
				facets: { enumeration: ['1', 'a'] },
			},
			value: 'b',
			expected: { reason: 'enumeration', actual: 'b', expected: ['1', 'a'], facet: 'enumeration' },
		},
		'union with a pattern, on the normalized value → pattern': {
			type: { union: [{ builtin: 'integer' }], facets: { pattern: [['[0-9]+']] } },
			value: ' -1 ',
			expected: { reason: 'pattern', actual: '-1', expected: ['[0-9]+'], facet: 'pattern' },
		},
		'union with a list member, a list → admitted': {
			type: {
				union: [
					{ list: { builtin: 'integer' } },
					{ builtin: 'token', facets: { enumeration: ['none'] } },
				],
			},
			value: '1 2',
			expected: undefined,
		},
	})
})
