import { isFullTable } from './store-contract.full-table'
import { contractGroups } from './store-contract.groups'
import { caseRegistrationOf } from './store-contract.registration'
import { runsOnLeg } from './store-contract.runs-on-leg'
import { contractTagsOf } from './store-contract.tags'

import { afterEach, beforeEach, describe, it } from 'vitest'

import type { Store } from '../store.types'
import type {
	StoreContractContext,
	StoreContractFactory,
	StoreContractSubset,
} from './store-contract.types'

/**
 * What any store must do, run on one leg: the leg's file calls it. A case gets a fresh store and the factory's ways
 * to see its state again; every store it opened is released after it. A `transport` leg (an engine behind a port)
 * runs the transport cases and skips the others, unless the full table is asked for (`STORE_CONTRACT_FULL_TABLE`).
 */
export function defineStoreContractLeg(params: {
	factory: StoreContractFactory
	subset: StoreContractSubset
}): void {
	const { factory, subset } = params
	// read by its name, not a computed key: the browser's runner fills `import.meta.env` member by member
	const fullTable = isFullTable({ value: import.meta.env.STORE_CONTRACT_FULL_TABLE })
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
				connectInRealm: async function connectStoreInRealm() {
					const connectInRealm = factory.connectInRealm ?? factory.connect
					if (!connectInRealm) throw new Error(`${factory.name} has no second connection`)
					const other = await connectInRealm(current.store)
					opened.push(other)
					return other
				},
				createNamed: async function createNamedStore({ name }) {
					const store = await factory.createNamed({ name })
					others.push(store)
					return store
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
				destroyWhileAway: async function destroyWhileAway({ remake }) {
					if (!factory.destroyWhileAway) throw new Error(`${factory.name} sends no view away`)
					await factory.destroyWhileAway({ store: current.store, remake })
				},
				connectAsOtherDialecte: async function connectAsOtherDialecte() {
					if (!factory.connectAsOtherDialecte) {
						throw new Error(`${factory.name} opens no other dialecte's project`)
					}
					const other = await factory.connectAsOtherDialecte({ store: current.store })
					others.push(other)
					return other
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

		for (const { table, group, cases } of contractGroups()) {
			describe(group, () => {
				for (const [description, testCase] of Object.entries(cases)) {
					const tags = contractTagsOf({ table, group, description, needs: testCase.needs })
					const registration = caseRegistrationOf({
						factory,
						testCase,
						description,
						runs: runsOnLeg({ tags, subset, fullTable }),
					})
					function run(): Promise<void> {
						if (!context) throw new Error(`${factory.name} gave no store`)
						return testCase.act(context)
					}
					if (registration.mode === 'skip') it.skip(registration.name, { tags }, run)
					// expected to fail: once the leg serves the part, the case passes and this flags the stale entry
					else if (registration.mode === 'fails') it.fails(registration.name, { tags }, run)
					else if (registration.mode === 'only') it.only(registration.name, { tags }, run)
					else it(registration.name, { tags }, run)
				}
			})
		}
	})
}
