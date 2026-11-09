import { STORE_CONTRACT_DIFFERENCES, STORE_CONTRACT_FEATURES } from './store-contract.constants'

import type {
	CaseRegistration,
	StoreContractCase,
	StoreContractDifference,
	StoreContractFactory,
	StoreContractFeature,
	StoreContractNeed,
} from './store-contract.types'

/**
 * How a leg registers a case: its name says why it is skipped or pending on this leg (a storage it cannot fill, a
 * difference, a part of the port pending); a case outside the leg's subset (`runs` false) is skipped under that same
 * name, so a run with the full table and one without name the same cases.
 */
/** Why the leg cannot run the case yet: the reason of the first part of the port it needs and has pending. */
function pendingReasonOf(params: {
	factory: StoreContractFactory
	testCase: StoreContractCase
}): string | undefined {
	const { factory, testCase } = params
	for (const need of testCase.needs ?? []) {
		if (!isFeature(need)) continue
		const reason = factory.pending?.[need]
		if (reason) return reason
	}
	return undefined
}

function isDifference(need: StoreContractNeed): need is StoreContractDifference {
	return (STORE_CONTRACT_DIFFERENCES as readonly string[]).includes(need)
}

function isFeature(need: StoreContractNeed): need is StoreContractFeature {
	return (STORE_CONTRACT_FEATURES as readonly string[]).includes(need)
}

/**
 * How the leg answers otherwise, by design, a case needing it: its stated reason; a leg with no engine
 * to end and no reason stated stops the run.
 */
function differenceOf(params: {
	factory: StoreContractFactory
	testCase: StoreContractCase
}): string | undefined {
	const { factory, testCase } = params
	for (const need of testCase.needs ?? []) {
		if (!isDifference(need)) continue
		const reason = factory.differs?.[need]
		if (reason) return reason
		if (need === 'engine-end' && !factory.endEngine) {
			throw new Error(`${factory.name} neither ends its engine nor says why it cannot`)
		}
		if (need === 'dialecte-key' && !factory.connectAsOtherDialecte) {
			throw new Error(
				`${factory.name} neither opens another dialecte's project nor says why it cannot`,
			)
		}
		if (need === 'away' && !factory.destroyWhileAway) {
			throw new Error(`${factory.name} neither sends a view away nor says why it cannot`)
		}
	}
	return undefined
}

/** Why a leg's storage cannot be filled: its stated reason, required of a leg with no `fillStorage`. */
function unfillableReasonOf(params: { factory: StoreContractFactory }): string {
	const { factory } = params
	if (!factory.storageUnfillable) {
		throw new Error(`${factory.name} neither fills its storage nor says why it cannot`)
	}
	return factory.storageUnfillable
}

export function caseRegistrationOf(params: {
	factory: StoreContractFactory
	testCase: StoreContractCase
	description: string
	runs: boolean
}): CaseRegistration {
	const { factory, testCase, description, runs } = params
	// skipped first: a case this leg cannot set up never runs as an expected failure
	if (testCase.needs?.includes('full-storage') && !factory.fillStorage) {
		return { name: `${description} (skipped: ${unfillableReasonOf({ factory })})`, mode: 'skip' }
	}
	const differs = differenceOf({ factory, testCase })
	if (differs) return { name: `${description} (differs here: ${differs})`, mode: 'skip' }
	const pendingReason = pendingReasonOf({ factory, testCase })
	if (pendingReason) {
		return { name: `${description} (pending: ${pendingReason})`, mode: runs ? 'fails' : 'skip' }
	}
	const noSecondConnection = testCase.needs?.includes('second-connection') && !factory.connect
	if (!runs || noSecondConnection) return { name: description, mode: 'skip' }
	return { name: description, mode: testCase.only ? 'only' : 'run' }
}
