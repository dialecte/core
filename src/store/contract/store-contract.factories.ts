import { InMemoryStore } from '../in-memory'
import { DexieStore } from '../local'
import { createInProcessConnector } from '../sqlite/adapter/in-process-link'
import { SqliteStore } from '../sqlite/adapter/sqlite-store'
import { createContractRuntime } from './store-contract.import-session'

import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { StoreContractFactory } from './store-contract.types'

function uniqueName(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

/** An open in-memory store of that name: a new instance, the name's state. */
async function openInMemoryStore(name: string): Promise<InMemoryStore> {
	const store = new InMemoryStore(name, {
		writable: true,
		runtime: createContractRuntime(),
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
			runtime: createContractRuntime(),
		})
		await store.open()
		return store
	},
	reopen: async function reopenDexieStore(store) {
		await store.close()
		const reopened = new DexieStore(store.name, { runtime: createContractRuntime() })
		await reopened.open()
		return reopened
	},
	connect: async function connectDexieStore(store) {
		const other = new DexieStore(store.name, { runtime: createContractRuntime() })
		await other.open()
		return other
	},
}

/** An open SQLite store of that name, its engine run in this realm on an in-memory file of the name. */
async function openSqliteStore(name: string): Promise<SqliteStore> {
	const connector = createInProcessConnector({
		name,
		dialecteId: TEST_DIALECTE.id,
		runtime: createContractRuntime(),
	})
	const store = new SqliteStore({ name, connector })
	await store.open()
	return store
}

const sqliteInProcessStoreFactory: StoreContractFactory = {
	name: 'SqliteStore in-process',
	pending: {
		history: 'the engine keeps no history yet',
		blobs: 'the engine keeps no blobs yet',
		export: 'the engine runs no export yet',
	},
	create: async function createSqliteStore() {
		return openSqliteStore(uniqueName('store-contract-sqlite'))
	},
	reopen: async function reopenSqliteStore(store) {
		await store.close()
		return openSqliteStore(store.name)
	},
	connect: async function connectSqliteStore(store) {
		return openSqliteStore(store.name)
	},
}

/** The stores the contract runs over today; a new kind of store joins by adding its factory here. */
export const STORE_CONTRACT_FACTORIES: StoreContractFactory[] = [
	inMemoryStoreFactory,
	dexieStoreFactory,
	sqliteInProcessStoreFactory,
]
