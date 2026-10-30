import { POOL_ROOT_DIRECTORY } from '../sqlite/runtime/runtime.constants'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from '../sqlite/runtime/runtime.fixtures.constants'
import { STORE_CONTRACT } from './store-contract.cases'
import { STORE_CONTRACT_DIFFERENCES, STORE_CONTRACT_FEATURES } from './store-contract.constants'
import { STORE_EXPORT_CONTRACT } from './store-contract.export.cases'
import { STORE_CONTRACT_FACTORIES } from './store-contract.factories'
import { STORE_PATH_CONTRACT } from './store-contract.path.cases'
import { STORE_TEXT_CONTRACT } from './store-contract.text.cases'
import { STORE_WELL_FORMED_CONTRACT } from './store-contract.well-formed.cases'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Store } from '../store.types'
import type {
	StoreContractCase,
	StoreContractContext,
	StoreContractDifference,
	StoreContractFactory,
	StoreContractFeature,
	StoreContractNeed,
} from './store-contract.types'

// one leg spawns an engine worker per case: seconds apiece on a loaded machine
vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

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

/**
 * What any store must do, run over every store the factories know. A case gets a fresh store and
 * the factory's ways to see its state again; every store it opened is released after it.
 */
function runStoreContract(factory: StoreContractFactory): void {
	describe(factory.name, () => {
		let context: StoreContractContext | undefined
		let opened: Store[] = []
		let others: Store[] = []

		beforeEach(async () => {
			const store = await factory.create()
			opened = [store]
			const current: StoreContractContext = {
				store,
				reopen: async function reopenStore() {
					const reopened = await factory.reopen(current.store)
					current.store = reopened
					if (!opened.includes(reopened)) opened.push(reopened)
					return reopened
				},
				connect: async function connectStore() {
					if (!factory.connect) throw new Error(`${factory.name} has no second connection`)
					const other = await factory.connect(current.store)
					opened.push(other)
					return other
				},
				createOther: async function createOtherStore() {
					const other = await factory.create()
					others.push(other)
					return other
				},
				endEngine: async function endEngine() {
					if (!factory.endEngine) throw new Error(`${factory.name} has no engine to end`)
					await factory.endEngine({ store: current.store })
				},
				fillStorage: async function fillStorage() {
					if (!factory.fillStorage) throw new Error(`${factory.name} cannot fill its storage`)
					await factory.fillStorage({ store: current.store })
				},
			}
			context = current
		})

		afterEach(async () => {
			if (!context) return
			try {
				for (const store of opened) {
					if (store !== context.store) await store.close()
				}
				await context.store.destroy()
				for (const other of others) await other.destroy()
			} finally {
				// whatever a destroy did: what the leg opened for the case goes with it
				await factory.afterCase?.()
				context = undefined
				opened = []
				others = []
			}
		})

		for (const [group, cases] of Object.entries({
			...STORE_CONTRACT,
			...STORE_EXPORT_CONTRACT,
			...STORE_PATH_CONTRACT,
			...STORE_TEXT_CONTRACT,
			...STORE_WELL_FORMED_CONTRACT,
		})) {
			describe(group, () => {
				for (const [description, testCase] of Object.entries(cases)) {
					// skipped first: a case this leg cannot set up never runs as an expected failure
					if (testCase.needs?.includes('full-storage') && !factory.fillStorage) {
						it.skip(`${description} (skipped: ${unfillableReasonOf({ factory })})`)
						continue
					}
					const differs = differenceOf({ factory, testCase })
					if (differs) {
						it.skip(`${description} (differs here: ${differs})`)
						continue
					}
					const pendingReason = pendingReasonOf({ factory, testCase })
					if (pendingReason) {
						// expected to fail: once the leg serves the part, the case passes and this flags the stale entry
						it.fails(`${description} (pending: ${pendingReason})`, () => {
							if (!context) throw new Error(`${factory.name} gave no store`)
							return testCase.act(context)
						})
						continue
					}
					const skipped = testCase.needs?.includes('second-connection') && !factory.connect
					const testFn = skipped ? it.skip : testCase.only ? it.only : it
					testFn(description, () => {
						if (!context) throw new Error(`${factory.name} gave no store`)
						return testCase.act(context)
					})
				}
			})
		}
	})
}

for (const factory of STORE_CONTRACT_FACTORIES) {
	runStoreContract(factory)
}

describe('the store contract over every leg', () => {
	it('every store a case opened is destroyed after it: no pool of a contract leg left on the private file system', async () => {
		if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
			return
		const root = await navigator.storage.getDirectory()
		const left: string[] = []
		try {
			const pools = await root.getDirectoryHandle(POOL_ROOT_DIRECTORY)
			for await (const name of pools.keys()) {
				if (decodeURIComponent(name).startsWith('store-contract-')) left.push(name)
			}
		} catch {
			// no pool directory at all
		}
		expect(left).toEqual([])
	})
})
