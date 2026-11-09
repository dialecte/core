import { caseRegistrationOf } from './store-contract.registration'

import { describe, expect, it } from 'vitest'

import type {
	CaseRegistration,
	StoreContractCase,
	StoreContractFactory,
} from './store-contract.types'

/** A leg that opens nothing: what a registration reads of it is its name, connect, fill, pending and differences. */
function legOf(extra: Partial<StoreContractFactory>): StoreContractFactory {
	return {
		name: 'leg',
		create: async function create() {
			throw new Error('not opened in this test')
		},
		reopen: async function reopen() {
			throw new Error('not opened in this test')
		},
		createNamed: async function createNamed() {
			throw new Error('not opened in this test')
		},
		...extra,
	}
}

async function act(): Promise<void> {}

/** A case's focus flag, set: named so the table holds no focus marker of its own. */
const FOCUSED = true

type RegistrationCase = {
	factory: StoreContractFactory
	testCase: StoreContractCase
	runs: boolean
	registration: CaseRegistration
}

const PENDING_LEG = legOf({ pending: { history: 'history later' }, storageUnfillable: 'no fill' })
const DIFFERING_LEG = legOf({
	differs: { 'engine-end': 'no engine' },
	storageUnfillable: 'no fill',
})

const CASES: Record<string, RegistrationCase> = {
	'a case the leg runs: its own name, run': {
		factory: legOf({}),
		testCase: { act },
		runs: true,
		registration: { name: 'case', mode: 'run' },
	},
	'a case outside the subset: its own name, skipped': {
		factory: legOf({}),
		testCase: { act },
		runs: false,
		registration: { name: 'case', mode: 'skip' },
	},
	'a case focused with only: run alone': {
		factory: legOf({}),
		testCase: { act, only: FOCUSED },
		runs: true,
		registration: { name: 'case', mode: 'only' },
	},
	'a second connection on a leg without one: its own name, skipped': {
		factory: legOf({}),
		testCase: { act, needs: ['second-connection'] },
		runs: true,
		registration: { name: 'case', mode: 'skip' },
	},
	'a part of the port pending on the leg: named pending with its reason, an expected failure': {
		factory: PENDING_LEG,
		testCase: { act, needs: ['history'] },
		runs: true,
		registration: { name: 'case (pending: history later)', mode: 'fails' },
	},
	'pending and outside the subset: the same pending name, skipped': {
		factory: PENDING_LEG,
		testCase: { act, needs: ['history'] },
		runs: false,
		registration: { name: 'case (pending: history later)', mode: 'skip' },
	},
	'a difference of the leg: named with it, skipped': {
		factory: DIFFERING_LEG,
		testCase: { act, needs: ['engine-end'] },
		runs: true,
		registration: { name: 'case (differs here: no engine)', mode: 'skip' },
	},
	'a difference and outside the subset: the same name': {
		factory: DIFFERING_LEG,
		testCase: { act, needs: ['engine-end'] },
		runs: false,
		registration: { name: 'case (differs here: no engine)', mode: 'skip' },
	},
	'a full storage on a leg that cannot fill one: named with its reason, skipped, first': {
		factory: DIFFERING_LEG,
		testCase: { act, needs: ['full-storage', 'engine-end'] },
		runs: true,
		registration: { name: 'case (skipped: no fill)', mode: 'skip' },
	},
}

describe('caseRegistrationOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(
				caseRegistrationOf({
					factory: testCase.factory,
					testCase: testCase.testCase,
					description: 'case',
					runs: testCase.runs,
				}),
			).toEqual(testCase.registration)
		})
	}

	it('a leg with no engine to end and no reason stated: refused, naming the leg, even outside the subset', () => {
		expect(() =>
			caseRegistrationOf({
				factory: legOf({ name: 'silent leg' }),
				testCase: { act, needs: ['engine-end'] },
				description: 'case',
				runs: false,
			}),
		).toThrow(/silent leg neither ends its engine/)
	})
})
