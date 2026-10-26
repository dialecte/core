import { STORE_CONTRACT } from './store-contract.cases'
import { STORE_EXPORT_CONTRACT } from './store-contract.export.cases'
import { STORE_CONTRACT_FACTORIES } from './store-contract.factories'

import { afterEach, beforeEach, describe, it } from 'vitest'

import type { Store } from '../store.types'
import type { StoreContractContext, StoreContractFactory } from './store-contract.types'

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
			}
			context = current
		})

		afterEach(async () => {
			if (!context) return
			for (const store of opened) {
				if (store !== context.store) await store.close()
			}
			await context.store.destroy()
			for (const other of others) await other.destroy()
			context = undefined
			opened = []
			others = []
		})

		for (const [group, cases] of Object.entries({ ...STORE_CONTRACT, ...STORE_EXPORT_CONTRACT })) {
			describe(group, () => {
				for (const [description, testCase] of Object.entries(cases)) {
					const skipped = testCase.needs === 'second-connection' && !factory.connect
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
