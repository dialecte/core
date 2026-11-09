import { isFullTable } from './store-contract.full-table'

import { describe, expect, it } from 'vitest'

const CASES: Record<string, { value: string | undefined; full: boolean }> = {
	'1: the full table': { value: '1', full: true },
	'true: the full table': { value: 'true', full: true },
	'absent: not': { value: undefined, full: false },
	'empty: not': { value: '', full: false },
	'0: not': { value: '0', full: false },
	'false: not': { value: 'false', full: false },
}

describe('isFullTable', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(isFullTable({ value: testCase.value })).toBe(testCase.full)
		})
	}

	it('any other value is refused, naming the variable: a typo never runs the subset silently', () => {
		expect(() => isFullTable({ value: 'yes' })).toThrow(/STORE_CONTRACT_FULL_TABLE.*yes/)
	})
})
