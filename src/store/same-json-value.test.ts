import { sameJsonValue } from './same-json-value'

import { expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

type TestCase = BaseTestCase & { first: unknown; second: unknown; expected: boolean }

const testCases: Record<string, TestCase> = {
	'the same keys in another order → the same': {
		first: { a: 1, b: { c: 2, d: [1, 2] } },
		second: { b: { d: [1, 2], c: 2 }, a: 1 },
		expected: true,
	},
	'an array in another order → not the same': { first: [1, 2], second: [2, 1], expected: false },
	'a value changed → not the same': { first: { a: 1 }, second: { a: 2 }, expected: false },
	'a key more → not the same': { first: { a: 1 }, second: { a: 1, b: 2 }, expected: false },
	'both absent → the same': { first: undefined, second: undefined, expected: true },
}

runTestCases.generic(testCases, function act({ first, second, expected }) {
	expect(sameJsonValue({ first, second })).toBe(expected)
})
