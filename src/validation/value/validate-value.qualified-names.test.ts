import { pAndDefault, runCases } from './validate-value.fixtures'

import { describe } from 'vitest'

describe('validateValue - qualified names', () => {
	runCases({
		'QName, a bound prefix → admitted': {
			type: { builtin: 'QName' },
			value: 'p:local',
			namespaces: pAndDefault,
			expected: undefined,
		},
		'QName, unprefixed with no default namespace → admitted': {
			type: { builtin: 'QName' },
			value: 'local',
			expected: undefined,
		},
		'QName, the xml prefix with no lookup → admitted': {
			type: { builtin: 'QName' },
			value: 'xml:lang',
			expected: undefined,
		},
		'QName, an unbound prefix → datatype': {
			type: { builtin: 'QName' },
			value: 'q:local',
			namespaces: pAndDefault,
			expected: { reason: 'datatype', actual: 'q:local', expected: 'QName' },
		},
		'QName, two colons → datatype': {
			type: { builtin: 'QName' },
			value: 'p:a:b',
			namespaces: pAndDefault,
			expected: { reason: 'datatype', actual: 'p:a:b', expected: 'QName' },
		},
		'QName, a Clark name → datatype': {
			type: { builtin: 'QName' },
			value: '{urn:p}local',
			expected: { reason: 'datatype', actual: '{urn:p}local', expected: 'QName' },
		},
		'NOTATION, a bound prefix → admitted': {
			type: { builtin: 'NOTATION' },
			value: 'p:gif',
			namespaces: pAndDefault,
			expected: undefined,
		},
		'NOTATION, an unbound prefix → datatype': {
			type: { builtin: 'NOTATION' },
			value: 'q:gif',
			expected: { reason: 'datatype', actual: 'q:gif', expected: 'NOTATION' },
		},
	})
})
