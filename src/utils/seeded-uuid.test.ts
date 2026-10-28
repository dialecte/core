import { createSeededRandomUuid } from './seeded-uuid'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

const UUID_V4_LAYOUT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function takeIds(params: { seed: number; count: number }): string[] {
	const { seed, count } = params
	const nextUuid = createSeededRandomUuid({ seed })
	return Array.from({ length: count }, () => nextUuid())
}

describe('createSeededRandomUuid', () => {
	type TestCase = BaseTestCase & {
		seed: number
		otherSeed?: number
		expectation: 'same sequence' | 'other sequence' | 'uuid v4 layout' | 'distinct ids'
	}

	const testCases: Record<string, TestCase> = {
		'same seed → same ids': { seed: 42, expectation: 'same sequence' },
		'ids match the UUID v4 layout': { seed: 7, expectation: 'uuid v4 layout' },
		'another seed → another sequence': { seed: 1, otherSeed: 2, expectation: 'other sequence' },
		'seed 0 gives distinct ids': { seed: 0, expectation: 'distinct ids' },
	}

	runTestCases.generic(testCases, (testCase) => {
		const ids = takeIds({ seed: testCase.seed, count: 50 })
		switch (testCase.expectation) {
			case 'same sequence':
				expect(takeIds({ seed: testCase.seed, count: 50 })).toEqual(ids)
				expect(new Set(ids).size).toBe(ids.length)
				break
			case 'other sequence':
				expect(takeIds({ seed: testCase.otherSeed ?? 0, count: 50 })).not.toEqual(ids)
				break
			case 'uuid v4 layout':
				for (const id of ids) expect(id).toMatch(UUID_V4_LAYOUT)
				break
			case 'distinct ids':
				expect(new Set(ids).size).toBe(ids.length)
				break
		}
	})
})
