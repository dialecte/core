import { InMemoryStore } from '../in-memory'
import { DexieStore } from '../local'

import type { StoreContractFactory } from './store-contract.types'

function uniqueName(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

const inMemoryStoreFactory: StoreContractFactory = {
	name: 'InMemoryStore',
	create: async function createInMemoryStore() {
		const store = new InMemoryStore(uniqueName('store-contract-memory'), { writable: true })
		await store.open()
		return store
	},
	reopen: async function reopenInMemoryStore(store) {
		await store.close()
		await store.open()
		return store
	},
}

const dexieStoreFactory: StoreContractFactory = {
	name: 'DexieStore',
	create: async function createDexieStore() {
		const store = new DexieStore(uniqueName('store-contract-dexie'))
		await store.open()
		return store
	},
	reopen: async function reopenDexieStore(store) {
		await store.close()
		const reopened = new DexieStore(store.name)
		await reopened.open()
		return reopened
	},
	connect: async function connectDexieStore(store) {
		const other = new DexieStore(store.name)
		await other.open()
		return other
	},
}

/** The stores the contract runs over today; a new kind of store joins by adding its factory here. */
export const STORE_CONTRACT_FACTORIES: StoreContractFactory[] = [
	inMemoryStoreFactory,
	dexieStoreFactory,
]
