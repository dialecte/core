import { EngineStore } from '../engine/engine-store'
import { InMemoryStore } from '../in-memory'
import { DexieStore } from '../local'
import { createInProcessConnector, fillInProcessFile } from '../sqlite/adapter/in-process-link'
import {
	CONTRACT_ENGINE_CHANNEL,
	CONTRACT_ENGINE_URL,
	ENGINE_END_BUDGET_MS,
	ENGINE_END_POLL_MS,
	HUB_DESTROY_ASK_INTERVAL_MS,
	HUB_DESTROY_ASKS,
	IN_PAGE_IMPORT_REASON,
	IN_PROCESS_ENGINE_REASON,
} from './store-contract.constants'
import { createContractRuntime } from './store-contract.import-session'

import { toDialecteError } from '@/errors'
import { createHubConnector } from '@/store/engine/client/hub-connector'
import { startHubConnection } from '@/store/engine/hub/hub-client'
import { serveHub } from '@/store/engine/hub/hub-shell'
import { sqliteHubSpawner } from '@/store/sqlite/adapter/sqlite-hub-spawner'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'
import { isEngineLockFree } from '@/store/sqlite/runtime/runtime.fixtures'
import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { ContractEngineOrder, StoreContractFactory } from './store-contract.types'
import type { HubConnection } from '@/store/engine/hub/hub-client.types'
import type { HubShell } from '@/store/engine/hub/hub-shell.types'
import type { Store } from '@/store/store.types'

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
	storageUnfillable: 'an in-memory store has no storage limit',
	differs: { 'engine-end': IN_PAGE_IMPORT_REASON },
}

const dexieStoreFactory: StoreContractFactory = {
	differs: { 'engine-end': IN_PAGE_IMPORT_REASON },
	name: 'DexieStore',
	storageUnfillable:
		"a test cannot fill IndexedDB; IndexedDB refusing a write for want of space answers the write's own key (STORE_COMMIT_FAILED, STORE_BULK_ADD_FAILED...), not STORE_QUOTA_EXCEEDED, until the local store moves to SQLite",
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
async function openSqliteStore(name: string): Promise<EngineStore> {
	const connector = createInProcessConnector({
		name,
		dialecteId: TEST_DIALECTE.id,
		runtime: createContractRuntime(),
	})
	const store = new EngineStore({ name, connector })
	await store.open()
	return store
}

const sqliteInProcessStoreFactory: StoreContractFactory = {
	name: 'EngineStore in-process',
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
	differs: { 'engine-end': IN_PROCESS_ENGINE_REASON },
	fillStorage: async function fillSqliteFile({ store }) {
		await fillInProcessFile({ name: store.name })
	},
}

/** An open SQLite store of that name, its engine run in a worker of this realm on the origin's private files. */
async function openWorkerStore(name: string): Promise<EngineStore> {
	const connector = createSqliteWorkerConnector({
		name,
		engineUrl: CONTRACT_ENGINE_URL,
		perf: true,
	})
	const store = new EngineStore({ name, connector })
	await store.open()
	return store
}

const sqliteWorkerStoreFactory: StoreContractFactory = {
	endEngine: async function endWorkerEngine({ store }) {
		await endContractEngine({ project: store.name })
	},
	name: 'EngineStore worker',
	create: async function createWorkerStore() {
		return openWorkerStore(uniqueName('store-contract-worker'))
	},
	reopen: async function reopenWorkerStore(store) {
		await store.close()
		return openWorkerStore(store.name)
	},
	connect: async function connectWorkerStore(store) {
		return openWorkerStore(store.name)
	},
	storageUnfillable:
		"a test cannot fill the private file system from the page: the runtime's disk-full cases cover this leg",
}

/** The contract's engine worker serving `project` ended, as one that dies (its work in flight lost). */
async function endContractEngine(params: { project: string }): Promise<void> {
	const order: ContractEngineOrder = { type: 'end', project: params.project }
	const channel = new BroadcastChannel(CONTRACT_ENGINE_CHANNEL)
	channel.postMessage(order)
	channel.close()
	// gone once its lock is let go
	const deadline = performance.now() + ENGINE_END_BUDGET_MS
	while (!(await isEngineLockFree({ project: params.project }))) {
		if (performance.now() > deadline) {
			throw new Error(
				`the engine of ${params.project} did not end within ${ENGINE_END_BUDGET_MS} ms`,
			)
		}
		await new Promise(function waitAWhile(resolve) {
			setTimeout(resolve, ENGINE_END_POLL_MS)
		})
	}
}

/** The page's one hub for the contract, on MessageChannels: made once. */
let contractHub: HubShell | undefined

/** The realms the hub leg opened for the case running: closed once it is done. */
const caseRealms: HubConnection[] = []

/** A realm of its own on the contract's hub, starting the contract's engines; closed after the case. */
async function joinContractHub(): Promise<HubConnection> {
	contractHub ??= serveHub()
	const hub = contractHub
	const realm = await startHubConnection({
		openPort: function hubPort() {
			const channel = new MessageChannel()
			hub.connect({ port: channel.port2 })
			return { port: channel.port1 }
		},
		topLevel: true,
		spawners: [
			sqliteHubSpawner({
				dialecteId: TEST_DIALECTE.id,
				dialecteVersion: TEST_DIALECTE.version,
				engineUrl: CONTRACT_ENGINE_URL,
				perf: true,
			}),
		],
		holdsLock: true,
		lifecycle: undefined,
	})
	caseRealms.push(realm)
	return realm
}

/** A store through its realm of the hub (a case may go on through another connection after a destroy: the realm stays). */
class HubContractStore extends EngineStore {
	readonly realm: HubConnection

	constructor(params: { name: string; realm: HubConnection }) {
		const { name, realm } = params
		super({
			name,
			connector: createHubConnector({
				name,
				connection: realm,
				dialecteId: TEST_DIALECTE.id,
				dialecteVersion: TEST_DIALECTE.version,
				engineUrl: CONTRACT_ENGINE_URL,
			}),
		})
		this.realm = realm
	}

	/**
	 * Through the hub a destroy is refused while another realm uses the project; a connection of another
	 * realm closed just before may still be on its way (its leave and this destroy cross on two ports): asked
	 * again then, each ask awaited, a few times at most.
	 */
	override async destroy(): Promise<void> {
		for (let ask = 1; ; ask++) {
			try {
				return await super.destroy()
			} catch (thrown) {
				if (toDialecteError(thrown)?.key !== 'PROJECT_OPEN_ELSEWHERE' || ask === HUB_DESTROY_ASKS)
					throw thrown
				await new Promise(function waitForTheLeave(resolve) {
					setTimeout(resolve, HUB_DESTROY_ASK_INTERVAL_MS)
				})
			}
		}
	}
}

/** An open SQLite store of that name, its engine elected and hosted through the hub by `realm`. */
async function openHubStore(params: {
	name: string
	realm: HubConnection
}): Promise<HubContractStore> {
	const store = new HubContractStore(params)
	await store.open()
	return store
}

function realmOf(store: Store): HubConnection {
	if (!(store instanceof HubContractStore))
		throw new Error(`${store.name} is not a store of the hub leg`)
	return store.realm
}

/**
 * The hub leg: every view a realm of its own on the page's hub - the store, and each second connection (as
 * a second tab). A reopen ends the store's realm only, and its engine with it while that realm hosts it (as
 * an engine that died), then opens the store on a new realm: with no other view on the project, the next
 * engine starts, as a reopen starts one in direct mode. The case's realms are closed after it.
 */
const sqliteHubStoreFactory: StoreContractFactory = {
	name: 'EngineStore hub',
	create: async function createHubStore() {
		const realm = await joinContractHub()
		return openHubStore({ name: uniqueName('store-contract-hub'), realm })
	},
	reopen: async function reopenHubStore(store) {
		await store.close()
		realmOf(store).close()
		const realm = await joinContractHub()
		return openHubStore({ name: store.name, realm })
	},
	// another view, as a second tab: a realm of its own
	connect: async function connectHubStore(store) {
		const realm = await joinContractHub()
		return openHubStore({ name: store.name, realm })
	},
	endEngine: async function endHubEngine({ store }) {
		// the page hosting it goes, as a tab closed: its engines with it
		realmOf(store).close()
	},
	storageUnfillable:
		"a test cannot fill the private file system from the page: the runtime's disk-full cases cover this leg",
	afterCase: async function closeCaseRealms() {
		for (const realm of caseRealms.splice(0)) realm.close()
	},
}

/** Whether this realm can run an engine worker on the origin's private files (a browser, not node). */
function canRunEngineWorker(): boolean {
	return typeof Worker === 'function' && typeof navigator.storage?.getDirectory === 'function'
}

/** The stores the contract runs over today; a new kind of store joins by adding its factory here. */
export const STORE_CONTRACT_FACTORIES: StoreContractFactory[] = [
	inMemoryStoreFactory,
	dexieStoreFactory,
	sqliteInProcessStoreFactory,
	...(canRunEngineWorker() ? [sqliteWorkerStoreFactory, sqliteHubStoreFactory] : []),
]
