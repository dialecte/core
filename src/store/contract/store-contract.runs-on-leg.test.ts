import { runsOnLeg } from './store-contract.runs-on-leg'

import { describe, expect, it } from 'vitest'

import type { StoreContractSubset, StoreContractTag } from './store-contract.types'

type LegCase = {
	tags: StoreContractTag[]
	subset: StoreContractSubset
	fullTable: boolean
	runs: boolean
}

const CASES: Record<string, LegCase> = {
	'a full leg runs a case without tags': { tags: [], subset: 'full', fullTable: false, runs: true },
	'a full leg runs a transport case': {
		tags: ['transport'],
		subset: 'full',
		fullTable: false,
		runs: true,
	},
	'a transport leg runs a transport case': {
		tags: ['transport'],
		subset: 'transport',
		fullTable: false,
		runs: true,
	},
	'a transport leg leaves a case without tags out': {
		tags: [],
		subset: 'transport',
		fullTable: false,
		runs: false,
	},
	'a transport leg runs every case when the full table is asked for': {
		tags: [],
		subset: 'transport',
		fullTable: true,
		runs: true,
	},
}

describe('runsOnLeg', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(
				runsOnLeg({ tags: testCase.tags, subset: testCase.subset, fullTable: testCase.fullTable }),
			).toBe(testCase.runs)
		})
	}
})
