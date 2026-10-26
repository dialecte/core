import { deviceCacheMiB } from './device-cache'

import { describe, expect, it } from 'vitest'

describe('deviceCacheMiB', () => {
	type TestCase = { deviceMemoryGiB: number | undefined; expectedMiB: number }
	const testCases: Record<string, TestCase> = {
		'0.5 GiB → the 64 MiB floor': { deviceMemoryGiB: 0.5, expectedMiB: 64 },
		'1 GiB → 64 MiB': { deviceMemoryGiB: 1, expectedMiB: 64 },
		'4 GiB → 256 MiB': { deviceMemoryGiB: 4, expectedMiB: 256 },
		'8 GiB → 512 MiB': { deviceMemoryGiB: 8, expectedMiB: 512 },
		'16 GiB → the 512 MiB ceiling': { deviceMemoryGiB: 16, expectedMiB: 512 },
		'not reported (Firefox, node) → sized for a 4 GiB device: 256 MiB': {
			deviceMemoryGiB: undefined,
			expectedMiB: 256,
		},
	}

	it('a rule of its own → its MiB per GiB, floor and ceiling', () => {
		const rule = { mibPerGiB: 10, floorMiB: 15, ceilingMiB: 30 }
		expect(deviceCacheMiB({ deviceMemoryGiB: 1, rule })).toBe(15)
		expect(deviceCacheMiB({ deviceMemoryGiB: 2, rule })).toBe(20)
		expect(deviceCacheMiB({ deviceMemoryGiB: 8, rule })).toBe(30)
	})

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			expect(deviceCacheMiB({ deviceMemoryGiB: testCase.deviceMemoryGiB })).toBe(
				testCase.expectedMiB,
			)
		})
	}
})
