import { idsInEvery } from './ids-in-every'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

type TestCase = BaseTestCase & { sets: string[][]; expected: string[] }

describe('idsInEvery', () => {
	const testCases: Record<string, TestCase> = {
		'one set → its ids': { sets: [['b', 'a']], expected: ['a', 'b'] },
		'two sets → the ids both hold': {
			sets: [
				['a', 'b', 'c'],
				['c', 'a', 'z'],
			],
			expected: ['a', 'c'],
		},
		'three sets, the smallest last → the ids all hold': {
			sets: [
				['a', 'b', 'c', 'd'],
				['b', 'c', 'd'],
				['d', 'b'],
			],
			expected: ['b', 'd'],
		},
		'an empty set among them → nothing': { sets: [['a'], []], expected: [] },
		'no set → nothing': { sets: [], expected: [] },
	}

	function act(testCase: TestCase): void {
		expect(idsInEvery(testCase.sets.map((ids) => new Set(ids))).sort()).toEqual(testCase.expected)
	}

	runTestCases.generic(testCases, act)
})
