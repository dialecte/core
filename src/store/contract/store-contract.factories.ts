import { EngineStore } from '../engine/engine-store'
import { InMemoryStore } from '../in-memory'
import { DexieStore } from '../local'
import { createInProcessConnector, fillInProcessFile } from '../sqlite/adapter/in-process-link'
import {
	CONTRACT_ENGINE_CHANNEL,
	CONTRACT_ENGINE_URL,
	AWAY_UNREACHABLE_REASON,
	CONTRACT_OTHER_DIALECTE_ID,
	ENGINE_END_BUDGET_MS,
	ENGINE_END_POLL_MS,
	IN_PAGE_IMPORT_REASON,
	IN_PROCESS_ENGINE_REASON,
} from './store-contract.constants'
import { makeDocument } from './store-contract.fixtures'
import { createContractRuntime } from './store-contract.import-session'

import { ENGINE_OPEN_BUDGET_MS } from '@/store/engine/client/client.constants'
import { createHubConnector } from '@/store/engine/client/hub-connector'
import { destroyFromFreshWorker } from '@/store/engine/client/worker-connector'
import { startHubConnection } from '@/store/engine/hub/hub-client'
import { serveHub } from '@/store/engine/hub/hub-shell'
import { REALM_LOCK_PREFIX } from '@/store/engine/hub/hub.constants'
import { fakePage } from '@/store/engine/hub/hub.fixtures'
import { sqliteHubSpawner } from '@/store/sqlite/adapter/sqlite-hub-spawner'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'
import { fixtureUrl, isEngineLockFree } from '@/store/sqlite/runtime/runtime.fixtures'
import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { ContractEngineOrder, StoreContractFactory } from './store-contract.types'
import type { HubConnection } from '@/store/engine/hub/hub-client.types'
import type { HubShell } from '@/store/engine/hub/hub-shell.types'
import type { FakePage } from '@/store/engine/hub/hub.fixtures.types'
import type { Store } from '@/store/store.types'

function uniqueName(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

/** An open in-memory store of that name, of the test dialecte unless another is named: a new instance, the project's state. */
async function openInMemoryStore(params: {
	name: string
	dialecteId?: string
}): Promise<InMemoryStore> {
	const { name, dialecteId = TEST_DIALECTE.id } = params
	const store = new InMemoryStore(name, {
		writable: true,
		runtime: createContractRuntime(),
		dialecteId,
	})
	await store.open()
	return store
}

const inMemoryStoreFactory: StoreContractFactory = {
	name: 'InMemoryStore',
	createNamed: async function createNamedInMemoryStore({ name }) {
		const store = new InMemoryStore(name, { writable: true, runtime: createContractRuntime() })
		await store.open()
		return store
	},
	create: async function createInMemoryStore() {
		return openInMemoryStore({ name: uniqueName('store-contract-memory') })
	},
	reopen: async function reopenInMemoryStore(store) {
		await store.close()
		return openInMemoryStore({ name: store.name })
	},
	connect: async function connectInMemoryStore(store) {
		return openInMemoryStore({ name: store.name })
	},
	connectAsOtherDialecte: async function connectInMemoryAsOther({ store }) {
		return openInMemoryStore({ name: store.name, dialecteId: CONTRACT_OTHER_DIALECTE_ID })
	},
	storageUnfillable: 'an in-memory store has no storage limit',
	differs: { 'engine-end': IN_PAGE_IMPORT_REASON, away: AWAY_UNREACHABLE_REASON },
}

const dexieStoreFactory: StoreContractFactory = {
	differs: {
		'engine-end': IN_PAGE_IMPORT_REASON,
		'dialecte-key':
			'an IndexedDB database is named by the project name alone: naming it by dialecte too would leave every project stored so far behind; the local store moves to SQLite (keyed by dialecte and name) in 0.9.0',
		away: 'a frozen tab keeps its connection’s hold on the database: another tab’s destroy is refused until that tab is gone, so no view of it is ever away',
	},
	name: 'DexieStore',
	createNamed: async function createNamedDexieStore({ name }) {
		const store = new DexieStore(name, { runtime: createContractRuntime() })
		await store.open()
		return store
	},
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

/** An open SQLite store of that name (of the test dialecte unless another is named), its engine run in this realm on an in-memory file of the project. */
async function openSqliteStore(params: {
	name: string
	dialecteId?: string
}): Promise<EngineStore> {
	const { name, dialecteId = TEST_DIALECTE.id } = params
	const connector = createInProcessConnector({
		name,
		dialecteId,
		runtime: createContractRuntime(),
	})
	const store = new EngineStore({ name, connector })
	await store.open()
	return store
}

const sqliteInProcessStoreFactory: StoreContractFactory = {
	name: 'EngineStore in-process',
	createNamed: async function createNamedSqliteStore({ name }) {
		return openSqliteStore({ name })
	},
	create: async function createSqliteStore() {
		return openSqliteStore({ name: uniqueName('store-contract-sqlite') })
	},
	reopen: async function reopenSqliteStore(store) {
		await store.close()
		return openSqliteStore({ name: store.name })
	},
	connect: async function connectSqliteStore(store) {
		return openSqliteStore({ name: store.name })
	},
	connectAsOtherDialecte: async function connectSqliteAsOther({ store }) {
		return openSqliteStore({ name: store.name, dialecteId: CONTRACT_OTHER_DIALECTE_ID })
	},
	differs: { 'engine-end': IN_PROCESS_ENGINE_REASON, away: AWAY_UNREACHABLE_REASON },
	fillStorage: async function fillSqliteFile({ store }) {
		await fillInProcessFile({ name: store.name, dialecteId: TEST_DIALECTE.id })
	},
}

/**
 * An open SQLite store of that name, its engine run in a worker of this realm on the origin's private files: the
 * contract's engine, or the engine of another dialecte (`other`).
 */
async function openWorkerStore(params: {
	name: string
	dialecteId?: string
}): Promise<EngineStore> {
	const { name, dialecteId = TEST_DIALECTE.id } = params
	const other = dialecteId === CONTRACT_OTHER_DIALECTE_ID
	const connector = createSqliteWorkerConnector({
		name,
		dialecteId,
		dialecteVersion: TEST_DIALECTE.version,
		engineUrl: other ? fixtureUrl({ scenario: 'other-dialecte' }) : CONTRACT_ENGINE_URL,
		perf: true,
	})
	const store = new EngineStore({ name, connector })
	await store.open()
	return store
}

const sqliteWorkerStoreFactory: StoreContractFactory = {
	// its engine ended with the view (a crash), another tab destroys the project through a worker of its own
	destroyWhileAway: async function destroyWhileWorkerAway({ store, remake }) {
		await endContractEngine({ project: store.name })
		await destroyFromFreshWorker({
			name: store.name,
			dialecteId: TEST_DIALECTE.id,
			engineUrl: CONTRACT_ENGINE_URL,
			budgetMs: ENGINE_OPEN_BUDGET_MS,
			lock: 'if-available',
		})
		if (remake) await remakeProject({ open: openWorkerStore, name: store.name })
	},
	endEngine: async function endWorkerEngine({ store }) {
		await endContractEngine({ project: store.name })
	},
	name: 'EngineStore worker',
	createNamed: async function createNamedWorkerStore({ name }) {
		return openWorkerStore({ name })
	},
	create: async function createWorkerStore() {
		return openWorkerStore({ name: uniqueName('store-contract-worker') })
	},
	reopen: async function reopenWorkerStore(store) {
		await store.close()
		return openWorkerStore({ name: store.name })
	},
	connect: async function connectWorkerStore(store) {
		return openWorkerStore({ name: store.name })
	},
	connectAsOtherDialecte: async function connectWorkerAsOther({ store }) {
		return openWorkerStore({ name: store.name, dialecteId: CONTRACT_OTHER_DIALECTE_ID })
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

/** The page each realm of the hub leg runs on. */
const REALM_PAGES = new WeakMap<HubConnection, FakePage>()

/**
 * A realm of its own on the contract's hub, starting the contract's engines and the other dialecte's, on a page
 * the case can freeze and resume (`REALM_PAGES`); closed after the case.
 */
async function joinContractHub(): Promise<HubConnection> {
	contractHub ??= serveHub()
	const hub = contractHub
	const page = fakePage()
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
			sqliteHubSpawner({
				dialecteId: CONTRACT_OTHER_DIALECTE_ID,
				dialecteVersion: TEST_DIALECTE.version,
				engineUrl: fixtureUrl({ scenario: 'other-dialecte' }),
			}),
		],
		holdsLock: true,
		lifecycle: page,
	})
	REALM_PAGES.set(realm, page)
	caseRealms.push(realm)
	return realm
}

/**
 * The store's page frozen - its realm gone for the hub once the hub has its lock (asked after the hub, granted
 * after it) - while another tab destroys the project, then resumed.
 */
async function destroyWhileRealmAway(params: { store: Store; remake: boolean }): Promise<void> {
	const { store, remake } = params
	const realm = realmOf(store)
	const page = REALM_PAGES.get(realm)
	if (!page) throw new Error(`${store.name} has no page to freeze`)
	const realmId = realm.realmId()
	page.freeze()
	await navigator.locks.request(`${REALM_LOCK_PREFIX}${realmId}`, function hubSawItGone() {})
	const other = await openHubStore({ name: store.name, realm: await joinContractHub() })
	await other.destroy()
	if (remake) {
		await other.open()
		await other.registerDocument(makeDocument({ id: 'remade' }))
	}
	await other.close()
	page.resume()
}

/** Another view makes the project again under its name, a document `remade` in it, and closes. */
async function remakeProject(params: {
	open: (params: { name: string }) => Promise<Store>
	name: string
}): Promise<void> {
	const other = await params.open({ name: params.name })
	await other.registerDocument(makeDocument({ id: 'remade' }))
	await other.close()
}

/** A store through its realm of the hub (a case may go on through another connection after a destroy: the realm stays). */
class HubContractStore extends EngineStore {
	readonly realm: HubConnection

	constructor(params: { name: string; realm: HubConnection; dialecteId?: string }) {
		const { name, realm, dialecteId = TEST_DIALECTE.id } = params
		super({
			name,
			connector: createHubConnector({
				name,
				connection: realm,
				dialecteId,
				dialecteVersion: TEST_DIALECTE.version,
				// the engine a destroy runs through: the project's dialecte's
				engineUrl:
					dialecteId === CONTRACT_OTHER_DIALECTE_ID
						? fixtureUrl({ scenario: 'other-dialecte' })
						: CONTRACT_ENGINE_URL,
			}),
		})
		this.realm = realm
	}
}

/** An open SQLite store of that name, its engine elected and hosted through the hub by `realm`. */
async function openHubStore(params: {
	name: string
	realm: HubConnection
	dialecteId?: string
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
	createNamed: async function createNamedHubStore({ name }) {
		const realm = await joinContractHub()
		return openHubStore({ name, realm })
	},
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
	// another dialecte's project of the name, as another tab opens it
	connectAsOtherDialecte: async function connectHubAsOther({ store }) {
		const realm = await joinContractHub()
		return openHubStore({ name: store.name, realm, dialecteId: CONTRACT_OTHER_DIALECTE_ID })
	},
	// a second Project of the page: a store of the name on the store's own realm
	connectInRealm: async function connectHubStoreInRealm(store) {
		return openHubStore({ name: store.name, realm: realmOf(store) })
	},
	destroyWhileAway: destroyWhileRealmAway,
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
