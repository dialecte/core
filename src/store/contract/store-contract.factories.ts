import { InMemoryStore } from '../in-memory'
import { DexieStore } from '../local'
import { createContractImportRuntime } from './store-contract.import-session'

import type { StoreContractFactory } from './store-contract.types'

function uniqueName(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

/** An open in-memory store of that name: a new instance, the name's state. */
async function openInMemoryStore(name: string): Promise<InMemoryStore> {
	const store = new InMemoryStore(name, {
		writable: true,
		importRuntime: createContractImportRuntime(),
	})
	await store.open()
	return store
}

const inMemoryStoreFactory: StoreContractFactory = {
	name: 'InMemoryStore',
	create: async function createInMemoryStore() {
		return openInMemoryStore(uniqueName('store-contract-memory'))
	},
	reopen: async function reopenInMemoryStore(store) {
		await store.close()
		return openInMemoryStore(store.name)
	},
	connect: async function connectInMemoryStore(store) {
		return openInMemoryStore(store.name)
	},
}

const dexieStoreFactory: StoreContractFactory = {
	name: 'DexieStore',
	create: async function createDexieStore() {
		const store = new DexieStore(uniqueName('store-contract-dexie'), {
			importRuntime: createContractImportRuntime(),
		})
		await store.open()
		return store
	},
	reopen: async function reopenDexieStore(store) {
		await store.close()
		const reopened = new DexieStore(store.name, { importRuntime: createContractImportRuntime() })
		await reopened.open()
		return reopened
	},
	connect: async function connectDexieStore(store) {
		const other = new DexieStore(store.name, { importRuntime: createContractImportRuntime() })
		await other.open()
		return other
	},
}

/** The stores the contract runs over today; a new kind of store joins by adding its factory here. */
export const STORE_CONTRACT_FACTORIES: StoreContractFactory[] = [
	inMemoryStoreFactory,
	dexieStoreFactory,
]
