import { makeDocument, outcomeOf } from '../../contract/store-contract.fixtures'
import { isEngineLockFree, TEST_ENGINE_URL } from '../../sqlite/runtime/runtime.fixtures'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from '../../sqlite/runtime/runtime.fixtures.constants'
import { SQLITE_WASM_URL } from '../../sqlite/sqlite-wasm-url'
import { fromThrownData, toThrownData } from '../wire/error-envelope'
import {
	adoptHubConnection,
	openHubConnection,
	sameOriginSpawners,
	startHubConnection,
} from './hub-client'
import { HUB_REGISTRY_KEY, HUB_WELCOME_BUDGET_MS } from './hub-client.constants'
import { connectHub } from './hub-public'
import { serveHub } from './hub-shell'
import { HUB_PROTOCOL_VERSION, REALM_LOCK_PREFIX } from './hub.constants'
import { fakePage } from './hub.fixtures'

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { createDialecteError, toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { ThrownData } from '../wire/wire.types'
import type {
	HubConnection,
	HubLifecycleTargets,
	HubProjectLink,
	SpawnerRealm,
} from './hub-client.types'
import type { HubToRealmMessage, RealmToHubMessage } from './hub-protocol.types'
import type { HubShell } from './hub-shell.types'
import type { FakePage } from './hub.fixtures.types'
import type { HubEngineSpawner } from './realm-host.types'
import type { DialecteErrorKey } from '@/errors'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

const SPAWNER: HubEngineSpawner = {
	dialecteId: TEST_DIALECTE.id,
	dialecteVersion: TEST_DIALECTE.version,
	engineUrl: TEST_ENGINE_URL,
	settings: { wasmUrl: SQLITE_WASM_URL },
}

/** What a case leaves: links released, so every engine closes. */
const links: HubProjectLink[] = []

afterEach(function releaseLinks() {
	for (const link of links.splice(0)) link.release()
})

/** A realm of this page connected to `hub` on a port of its own (a new one for each realm instance). */
function joinHub(params: {
	hub: HubShell
	spawners?: HubEngineSpawner[]
	lifecycle?: HubLifecycleTargets
}): Promise<HubConnection> {
	const { hub, spawners = [SPAWNER], lifecycle } = params
	return startHubConnection({
		openPort: function newPort() {
			const channel = new MessageChannel()
			hub.connect({ port: channel.port2 })
			return { port: channel.port1 }
		},
		topLevel: true,
		spawners,
		holdsLock: true,
		lifecycle,
	})
}

/** A hub a case answers for: every port a realm opens, what it said, the hellos with its lock at the time. */
type FakeHub = {
	openPort: () => MessagePort
	/** How many ports the realm opened: one per realm instance. */
	ports: () => number
	hellos: { realmId: string; message: RealmToHubMessage; lockHeld: boolean }[]
	/** The next message of that type the realm says (one said already counts). */
	next: <GenericType extends RealmToHubMessage['type']>(
		type: GenericType,
	) => Promise<Extract<RealmToHubMessage, { type: GenericType }>>
	received: RealmToHubMessage[]
	/** Said to the realm on its latest port. */
	reply: (message: HubToRealmMessage, transfer?: Transferable[]) => void
}

/**
 * A hub welcoming each hello, refusing those `refuses` picks and leaving unanswered those `silences`
 * picks (by their order, from 0).
 */
function fakeHub(
	params: {
		refuses?: (helloIndex: number) => boolean
		silences?: (helloIndex: number) => boolean
	} = {},
): FakeHub {
	const { refuses = refuseNone, silences = refuseNone } = params
	const ports: MessagePort[] = []
	const hellos: FakeHub['hellos'] = []
	const received: RealmToHubMessage[] = []
	const waiters: { type: string; resolve: (message: RealmToHubMessage) => void }[] = []
	function deliver(message: RealmToHubMessage): void {
		const waiter = waiters.find(function waitsFor(candidate) {
			return candidate.type === message.type
		})
		if (!waiter) {
			received.push(message)
			return
		}
		waiters.splice(waiters.indexOf(waiter), 1)
		waiter.resolve(message)
	}
	onTestFinished(function closeHub() {
		for (const port of ports) port.close()
	})
	return {
		hellos,
		received,
		ports: function portCount() {
			return ports.length
		},
		openPort: function openFakePort() {
			const channel = new MessageChannel()
			const hubEnd = channel.port2
			ports.push(hubEnd)
			hubEnd.onmessage = async function hearRealm(event: MessageEvent<RealmToHubMessage>) {
				const message = event.data
				if (message.type !== 'hello') return deliver(message)
				const { held = [] } = await navigator.locks.query()
				const lockHeld = held.some(function isRealmLock(lock) {
					return lock.name === `${REALM_LOCK_PREFIX}${message.realmId}`
				})
				const refused = refuses(hellos.length)
				const silent = silences(hellos.length)
				hellos.push({ realmId: message.realmId, message, lockHeld })
				if (silent) return
				const answer: HubToRealmMessage = refused
					? {
							type: 'hello-refused',
							error: toThrownData({
								thrown: createDialecteError('STORE_PROTOCOL_MISMATCH', {
									detail: 'another protocol',
								}),
							}),
						}
					: { type: 'welcome', realmId: message.realmId }
				hubEnd.postMessage(answer)
			}
			return channel.port1
		},
		next: function nextOf(type) {
			const index = received.findIndex(function isOfType(message) {
				return message.type === type
			})
			if (index >= 0) {
				const [message] = received.splice(index, 1)
				return Promise.resolve(message) as never
			}
			return new Promise(function waitForType(resolve) {
				waiters.push({ type, resolve: resolve as (message: RealmToHubMessage) => void })
			})
		},
		reply: function replyOnLatest(message, transfer = []) {
			ports.at(-1)?.postMessage(message, transfer)
		},
	}
}

function refuseNone(): boolean {
	return false
}

/** A top-level realm on a fake hub, the page's lifecycle driven by the case. */
function joinFakeHub(params: { hub: FakeHub; page?: FakePage }): Promise<HubConnection> {
	return startHubConnection({
		openPort: function fakeHubPort() {
			return { port: params.hub.openPort() }
		},
		topLevel: true,
		spawners: [SPAWNER],
		holdsLock: true,
		lifecycle: params.page,
	})
}

function openLink(params: { connection: HubConnection; project: string }): HubProjectLink {
	const link = params.connection.openProject({
		project: params.project,
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: TEST_DIALECTE.version,
	})
	links.push(link)
	return link
}

async function documentsThrough(params: { link: HubProjectLink }): Promise<unknown[]> {
	const client = await params.link.engine()
	return client.api.getDocuments()
}

async function registerThrough(params: { link: HubProjectLink }): Promise<void> {
	const client = await params.link.engine()
	await client.api.registerDocument(makeDocument())
}

/** The realm locks held in this page: one per live realm instance. */
async function countRealmLocks(): Promise<number> {
	const { held = [] } = await navigator.locks.query()
	return held.filter(function isRealmLock(lock) {
		return lock.name?.startsWith(REALM_LOCK_PREFIX)
	}).length
}

function isRealmLockFree(params: { realmId: string }): Promise<boolean> {
	return navigator.locks.request(
		`${REALM_LOCK_PREFIX}${params.realmId}`,
		{ ifAvailable: true },
		function grantedOrNot(lock) {
			return lock !== null
		},
	)
}

function uniqueProject(): string {
	return `hub-client-${crypto.randomUUID()}`
}

/** The realm's registry emptied for the case, put back after it. */
function withEmptyRegistry(): void {
	const registry = globalThis as unknown as Record<symbol, unknown>
	const kept = registry[HUB_REGISTRY_KEY]
	delete registry[HUB_REGISTRY_KEY]
	onTestFinished(function restoreRegistry() {
		registry[HUB_REGISTRY_KEY] = kept
	})
}

function pause(params: { ms: number }): Promise<void> {
	return new Promise(function waitAWhile(resolve) {
		setTimeout(resolve, params.ms)
	})
}

/** A port nobody answers on (a hub that never came up, or a parent that unbound it): its far end closed after the case. */
function silentPort(): MessagePort {
	const channel = new MessageChannel()
	onTestFinished(function closeSilentPort() {
		channel.port1.close()
		channel.port2.close()
	})
	return channel.port1
}

/** A SharedWorker whose script fails to load: its port answers nothing, its `error` fires soon after. */
function failingSharedWorker(params: { made: { count: number } }): typeof SharedWorker {
	return class FailingSharedWorker extends EventTarget {
		readonly port = silentPort()
		constructor() {
			super()
			params.made.count += 1
			setTimeout(this.failToLoad.bind(this), 10)
		}

		failToLoad(): void {
			this.dispatchEvent(new ErrorEvent('error', { message: 'the script failed to load' }))
		}
	} as unknown as typeof SharedWorker
}

describe('a realm connected to the hub', () => {
	it('the spawners it registers → those whose worker is of this origin only, a relative address kept', () => {
		const kept = sameOriginSpawners({
			spawners: [
				SPAWNER,
				{ ...SPAWNER, dialecteId: 'relative', engineUrl: './engine.worker.js' },
				{ ...SPAWNER, dialecteId: 'elsewhere', engineUrl: 'https://example.com/engine.js' },
			],
		})
		expect(
			kept.map(function idOf(spawner) {
				return spawner.dialecteId
			}),
		).toEqual([TEST_DIALECTE.id, 'relative'])
	})

	it('connected twice, from any copy of the library → one connection, kept under the protocol’s key; the page holds its realm id and child ports only', async () => {
		withEmptyRegistry()
		const first = openHubConnection()
		const second = openHubConnection()
		expect(second).toBe(first)
		const registry = globalThis as unknown as Record<symbol, unknown>
		expect(registry[Symbol.for(`@dialecte/core/hub/v${HUB_PROTOCOL_VERSION}`)]).toBe(first)
		const connection = await first
		expect(connection?.realmId()).toMatch(/^[0-9a-f-]{36}$/)
		onTestFinished(connection!.close)
		const realm = await connectHub()
		expect(Object.keys(realm ?? {}).toSorted()).toEqual(['createHubPort', 'realmId'])
		expect(realm?.realmId()).toBe(connection?.realmId())
	})

	it('no SharedWorker in the browser → no hub: `undefined`', async () => {
		withEmptyRegistry()
		vi.stubGlobal('SharedWorker', undefined)
		onTestFinished(function restoreGlobals() {
			vi.unstubAllGlobals()
		})
		const realm = await connectHub()
		expect(realm).toBeUndefined()
	})

	it('connectHub given the engines the page can start → its hello names them to the hub', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		vi.stubGlobal(
			'SharedWorker',
			class AnsweredSharedWorker extends EventTarget {
				readonly port = hub.openPort()
			},
		)
		onTestFinished(function restoreGlobals() {
			vi.unstubAllGlobals()
		})
		const realm = await connectHub({ spawners: [SPAWNER] })
		expect(realm).toBeDefined()
		const connection = await openHubConnection()
		onTestFinished(connection!.close)
		expect(hub.hellos[0]?.message).toMatchObject({
			spawners: [{ dialecteId: TEST_DIALECTE.id, dialecteVersion: TEST_DIALECTE.version }],
		})
	})

	it('a hub whose worker fails to start → the join refused STORE_CONNECTION_FAILED at once, the lock let go', async () => {
		const failure = createDialecteError('STORE_CONNECTION_FAILED', {
			detail: 'the hub could not start',
		})
		const locksBefore = await countRealmLocks()
		const connecting = startHubConnection({
			openPort: function failingPort() {
				return { port: silentPort(), failed: Promise.resolve(failure) }
			},
			topLevel: true,
			spawners: [],
			holdsLock: true,
			lifecycle: undefined,
		})
		const outcome = await outcomeOf({ promise: connecting })
		expect(outcome).toBe('STORE_CONNECTION_FAILED')
		// a lock is let go asynchronously
		await expect.poll(countRealmLocks).toBe(locksBefore)
	})

	it('a hub silent past the welcome budget → STORE_CONNECTION_FAILED, not a wait without end', async () => {
		const locksBefore = await countRealmLocks()
		const connecting = startHubConnection({
			openPort: function quietPort() {
				return { port: silentPort() }
			},
			topLevel: true,
			spawners: [],
			holdsLock: true,
			lifecycle: undefined,
			welcomeBudgetMs: 200,
		})
		const early = await outcomeOf({ promise: connecting, withinMs: 100 })
		expect(early).toBe('pending')
		const outcome = await outcomeOf({ promise: connecting, withinMs: 1_000 })
		expect(outcome).toBe('STORE_CONNECTION_FAILED')
		// a lock is let go asynchronously
		await expect.poll(countRealmLocks).toBe(locksBefore)
	})

	it('connectHub to a hub whose script fails to load → `undefined`, not kept: the next call tries again', async () => {
		withEmptyRegistry()
		const made = { count: 0 }
		vi.stubGlobal('SharedWorker', failingSharedWorker({ made }))
		onTestFinished(function restoreGlobals() {
			vi.unstubAllGlobals()
		})
		// at once, from the worker's error: well before the welcome budget
		const first = await outcomeOf({ promise: connectHub(), withinMs: 1_000 })
		expect(first).toBe('settled')
		const registry = globalThis as unknown as Record<symbol, unknown>
		expect(registry[HUB_REGISTRY_KEY]).toBeUndefined()
		const second = await outcomeOf({ promise: connectHub(), withinMs: 1_000 })
		expect(second).toBe('settled')
		const realm = await connectHub()
		expect(realm).toBeUndefined()
		expect(made.count).toBe(3)
	})

	it('a child adopting a port nobody answers (its parent unbound it first) → STORE_CONNECTION_FAILED after the welcome budget, nothing kept', async () => {
		withEmptyRegistry()
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		onTestFinished(function realTimers() {
			vi.useRealTimers()
		})
		const adopting = outcomeOf({
			promise: adoptHubConnection({ port: silentPort() }),
			withinMs: 60_000,
		})
		await vi.advanceTimersByTimeAsync(HUB_WELCOME_BUDGET_MS)
		const outcome = await adopting
		expect(outcome).toBe('STORE_CONNECTION_FAILED')
		const registry = globalThis as unknown as Record<symbol, unknown>
		expect(registry[HUB_REGISTRY_KEY]).toBeUndefined()
	})

	it('a connection the hub refused → a child port asked of it refused with the hub’s error', async () => {
		const hub = fakeHub({ refuses: refuseAfterFirst })
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		page.freeze()
		page.resume()
		await vi.waitFor(function refusedBack() {
			expect(hub.hellos).toHaveLength(2)
		})
		await vi.waitFor(function childPortRefused() {
			let thrown: unknown
			try {
				connection.createHubPort()
			} catch (error) {
				thrown = error
			}
			expect(toDialecteError(thrown)?.key).toBe('STORE_PROTOCOL_MISMATCH')
		})
	})

	it('a srcdoc iframe’s spawner given relative to its document → registered: resolved against the document’s base, not its `about:srcdoc` location', async () => {
		const frame = document.createElement('iframe')
		frame.srcdoc = '<!doctype html><p>child</p>'
		const loaded = new Promise(function waitForLoad(resolve) {
			frame.addEventListener('load', resolve, { once: true })
		})
		document.body.append(frame)
		onTestFinished(function removeFrame() {
			frame.remove()
		})
		await loaded
		const childRealm = frame.contentWindow as unknown as SpawnerRealm
		const relative = { ...SPAWNER, dialecteId: 'relative', engineUrl: './engine.worker.js' }
		const kept = sameOriginSpawners({ spawners: [relative], realm: childRealm })
		expect(kept).toEqual([relative])
		const byLocationOnly = sameOriginSpawners({
			spawners: [relative],
			realm: { location: { href: frame.contentWindow!.location.href }, origin: childRealm.origin },
		})
		expect(byLocationOnly).toEqual([])
	})

	it('a top-level realm → its lock held before its hello, its spawners named in it', async () => {
		const hub = fakeHub()
		await joinFakeHub({ hub })
		const [hello] = hub.hellos
		expect(hello?.lockHeld).toBe(true)
		expect(hello?.message).toMatchObject({
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			topLevel: true,
			spawners: [{ dialecteId: TEST_DIALECTE.id, dialecteVersion: TEST_DIALECTE.version }],
		})
	})

	it('a realm joining through a port it was handed → a client only: not top-level, no spawner, no lock of its own', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const adopted = await adoptHubConnection({ port: hub.openPort() })
		onTestFinished(adopted!.close)
		const [hello] = hub.hellos
		expect(hello?.lockHeld).toBe(false)
		expect(hello?.message).toMatchObject({ type: 'hello', topLevel: false, spawners: [] })
	})

	it('a hub refusing its hello → the connection refused with the hub’s error, its lock let go, the page no longer heard', async () => {
		const hub = fakeHub({ refuses: refuseAll })
		const page = fakePage()
		const connecting = joinFakeHub({ hub, page })
		const outcome = await outcomeOf({ promise: connecting })
		expect(outcome).toBe('STORE_PROTOCOL_MISMATCH')
		const [hello] = hub.hellos
		const lockFree = await isRealmLockFree({ realmId: hello!.realmId })
		expect(lockFree).toBe(true)
		page.freeze()
		page.resume()
		await pause({ ms: 100 })
		expect(hub.ports()).toBe(1)
	})

	it('back to a hub of another protocol → every link refused with its error, the lock let go', async () => {
		const hub = fakeHub({ refuses: refuseAfterFirst })
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		const link = openLink({ connection, project: uniqueProject() })
		const waiting = link.engine()
		page.freeze()
		page.resume()
		const outcome = await outcomeOf({ promise: waiting, withinMs: 2_000 })
		expect(outcome).toBe('STORE_PROTOCOL_MISMATCH')
		const later = await outcomeOf({
			promise: openLink({ connection, project: uniqueProject() }).engine(),
		})
		expect(later).toBe('STORE_PROTOCOL_MISMATCH')
		const lockFree = await isRealmLockFree({ realmId: hub.hellos[1]!.realmId })
		expect(lockFree).toBe(true)
		const endedWith = await connection.ended
		expect(toDialecteError(endedWith)?.key).toBe('STORE_PROTOCOL_MISMATCH')
	})

	it('back to a hub that cannot be reached → the calls refused STORE_CONNECTION_FAILED, no wait without end; tried again, joined once the hub answers', async () => {
		const hub = fakeHub({ silences: silenceSecond })
		const page = fakePage()
		const connection = await startHubConnection({
			openPort: function fakeHubPort() {
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [SPAWNER],
			holdsLock: true,
			lifecycle: page,
			welcomeBudgetMs: 200,
		})
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		const waiting = link.engine()
		await hub.next('open')
		page.freeze()
		page.resume()
		const waitingOutcome = await outcomeOf({ promise: waiting, withinMs: 1_000 })
		expect(waitingOutcome).toBe('STORE_CONNECTION_FAILED')
		const meanwhile = await outcomeOf({ promise: link.engine() })
		expect(meanwhile).toBe('STORE_CONNECTION_FAILED')
		let childPortRefusal: unknown
		try {
			connection.createHubPort()
		} catch (error) {
			childPortRefusal = error
		}
		expect(toDialecteError(childPortRefusal)?.key).toBe('STORE_CONNECTION_FAILED')
		// the third hello, a delay later, is welcomed: the link asked again
		const asked = await hub.next('open')
		expect(asked.project).toBe(project)
		expect(hub.hellos).toHaveLength(3)
	})

	it('a hub whose worker throws as it is made when the page comes back → the calls refused STORE_CONNECTION_FAILED; tried again later, joined', async () => {
		const hub = fakeHub()
		const page = fakePage()
		let opened = 0
		const connection = await startHubConnection({
			openPort: function throwOnSecond() {
				opened += 1
				if (opened === 2) throw new DOMException('site data blocked', 'SecurityError')
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [SPAWNER],
			holdsLock: true,
			lifecycle: page,
		})
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		const waiting = link.engine()
		await hub.next('open')
		page.freeze()
		page.resume()
		const outcome = await outcomeOf({ promise: waiting })
		expect(outcome).toBe('STORE_CONNECTION_FAILED')
		const asked = await hub.next('open')
		expect(asked.project).toBe(project)
		expect(opened).toBe(3)
	})

	it('a hub out of reach on every try → tried again after 1, 2, 4… s, never more than 30 s apart; a resume tries at once; closed → no more tries', async () => {
		const hub = fakeHub()
		const page = fakePage()
		let opened = 0
		const connection = await startHubConnection({
			openPort: function silentAfterFirst() {
				opened += 1
				return { port: opened === 1 ? hub.openPort() : silentPort() }
			},
			topLevel: true,
			spawners: [],
			holdsLock: false,
			lifecycle: page,
			welcomeBudgetMs: 100,
		})
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		onTestFinished(function realTimers() {
			vi.useRealTimers()
		})
		page.freeze()
		page.resume()
		expect(opened).toBe(2)
		await vi.advanceTimersByTimeAsync(100)
		for (const delayMs of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
			const before = opened
			await vi.advanceTimersByTimeAsync(delayMs - 1)
			expect(opened).toBe(before)
			await vi.advanceTimersByTimeAsync(1)
			expect(opened).toBe(before + 1)
			await vi.advanceTimersByTimeAsync(100)
		}
		const beforeResume = opened
		page.resume()
		expect(opened).toBe(beforeResume + 1)
		await vi.advanceTimersByTimeAsync(100)
		// the try the resume took the place of is not made as well: the next one comes 30 s after this failure
		await vi.advanceTimersByTimeAsync(30_000 - 1)
		expect(opened).toBe(beforeResume + 1)
		await vi.advanceTimersByTimeAsync(1)
		expect(opened).toBe(beforeResume + 2)
		await vi.advanceTimersByTimeAsync(100)
		connection.close()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(opened).toBe(beforeResume + 2)
	})

	it('closed while a try at the hub is failing → that failure ends nothing more: no try after it', async () => {
		const hub = fakeHub()
		const page = fakePage()
		let opened = 0
		const connection = await startHubConnection({
			openPort: function silentAfterFirst() {
				opened += 1
				return { port: opened === 1 ? hub.openPort() : silentPort() }
			},
			topLevel: true,
			spawners: [],
			holdsLock: false,
			lifecycle: page,
			welcomeBudgetMs: 100,
		})
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		onTestFinished(function realTimers() {
			vi.useRealTimers()
		})
		page.freeze()
		page.resume()
		// the welcome budget passes; the failure is on its way when the connection closes
		vi.advanceTimersByTime(100)
		connection.close()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(opened).toBe(2)
	})

	it('a child port made while a try at the hub is under way → refused to its child at once when that try fails, never bound after', async () => {
		const hub = fakeHub({ silences: silenceSecond })
		const page = fakePage()
		const connection = await startHubConnection({
			openPort: function fakeHubPort() {
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [],
			holdsLock: true,
			lifecycle: page,
			welcomeBudgetMs: 200,
		})
		onTestFinished(connection.close)
		const project = uniqueProject()
		// a call waiting: the link asks the hub (and is refused when the try fails)
		void openLink({ connection, project }).engine().catch(settleNothing)
		await hub.next('open')
		page.freeze()
		page.resume()
		const handle = connection.createHubPort()
		const toldChild = new Promise<HubToRealmMessage>(function hearChildPort(resolve) {
			handle.port.onmessage = function hearRefusal(event: MessageEvent<HubToRealmMessage>) {
				resolve(event.data)
			}
		})
		const told = await toldChild
		expect(told.type).toBe('hello-refused')
		expect(keyOfThrown({ data: told })).toBe('STORE_CONNECTION_FAILED')
		// the next try is welcomed: the link asked again, no child bound
		await hub.next('open')
		await pause({ ms: 100 })
		expect(hub.received.map(typeOfMessage)).not.toContain('bind-child')
	})

	it('closed as the hub’s refusal of the page coming back arrives → closed it stays: the calls refused STORE_CLOSED, not the hub’s refusal', async () => {
		const hub = fakeHub({ refuses: refuseAfterFirst })
		const page = fakePage()
		let connection: HubConnection | undefined
		let opened = 0
		connection = await startHubConnection({
			openPort: function closeAsRefused() {
				opened += 1
				const port = hub.openPort()
				// heard before the realm's own listener: the close lands while the refusal is on its way
				if (opened === 2) {
					port.addEventListener(
						'message',
						function closeOnRefusal(event: MessageEvent<HubToRealmMessage>) {
							if (event.data?.type === 'hello-refused') connection?.close()
						},
					)
				}
				return { port }
			},
			topLevel: true,
			spawners: [],
			holdsLock: true,
			lifecycle: page,
		})
		const link = openLink({ connection, project: uniqueProject() })
		page.freeze()
		page.resume()
		const endedWith = await connection.ended
		expect(toDialecteError(endedWith)?.key).toBe('STORE_CLOSED')
		await pause({ ms: 50 })
		const outcome = await outcomeOf({ promise: link.engine() })
		expect(outcome).toBe('STORE_CLOSED')
	})

	it('a port opener failing with a fault of its own (not the browser refusing a worker) → that fault surfaces: the connection refused with it, no retry', async () => {
		const hub = fakeHub()
		const page = fakePage()
		let opened = 0
		const connection = await startHubConnection({
			openPort: function faultOnSecond() {
				opened += 1
				if (opened === 2) throw new TypeError('openPort is broken')
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [],
			holdsLock: true,
			lifecycle: page,
		})
		page.freeze()
		page.resume()
		const endedWith = await connection.ended
		expect(endedWith).toBeInstanceOf(TypeError)
		await pause({ ms: 1_500 })
		expect(opened).toBe(2)
	})

	it('a realm already connected adopting another port → that port closed, the connection it has answered', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const first = await adoptHubConnection({ port: hub.openPort() })
		onTestFinished(first!.close)
		const spare = new MessageChannel()
		onTestFinished(function closeSpare() {
			spare.port2.close()
		})
		const closeSpy = vi.spyOn(spare.port1, 'close')
		const second = await adoptHubConnection({ port: spare.port1 })
		expect(second).toBe(first)
		expect(closeSpy).toHaveBeenCalled()
	})

	it('a connection closed → refused STORE_CLOSED for good, and forgotten: the next connectHub connects again', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const made = { count: 0 }
		vi.stubGlobal(
			'SharedWorker',
			class AnsweredSharedWorker extends EventTarget {
				readonly port = hub.openPort()
				constructor() {
					super()
					made.count += 1
				}
			},
		)
		onTestFinished(function restoreGlobals() {
			vi.unstubAllGlobals()
		})
		const connection = await openHubConnection()
		const link = openLink({ connection: connection!, project: uniqueProject() })
		connection!.close()
		const outcome = await outcomeOf({ promise: link.engine() })
		expect(outcome).toBe('STORE_CLOSED')
		await vi.waitFor(function forgotten() {
			const registry = globalThis as unknown as Record<symbol, unknown>
			expect(registry[HUB_REGISTRY_KEY]).toBeUndefined()
		})
		const again = await openHubConnection()
		onTestFinished(again!.close)
		expect(again).not.toBe(connection)
		expect(made.count).toBe(2)
	})

	it('a link released while a call waits for its engine → that call refused STORE_CLOSED', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const link = connection.openProject({
			project: uniqueProject(),
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: TEST_DIALECTE.version,
		})
		const waiting = link.engine()
		await hub.next('open')
		link.release()
		const outcome = await outcomeOf({ promise: waiting })
		expect(outcome).toBe('STORE_CLOSED')
	})

	it('a link released → its engine asked of it after refused STORE_CLOSED, the hub not asked again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const link = connection.openProject({
			project: uniqueProject(),
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: TEST_DIALECTE.version,
		})
		link.release()
		const outcome = await outcomeOf({ promise: link.engine() })
		expect(outcome).toBe('STORE_CLOSED')
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('open')
	})

	it('two links of a project → the realm leaves it once, with its last link', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const first = openLink({ connection, project })
		const second = openLink({ connection, project })
		void first.engine().catch(settleNothing)
		await hub.next('open')
		first.release()
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('leave')
		second.release()
		const left = await hub.next('leave')
		expect(left.project).toBe(project)
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('leave')
	})

	it('a connected link whose engine is lost, its next engine refused for good (another version) → every later call refused so, the hub not asked again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'engine-lost', project, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		hub.reply({
			type: 'open-refused',
			project,
			error: refusalData({ key: 'PROJECT_DIALECTE_VERSION_MISMATCH' }),
		})
		const refused = await outcomeOf({ promise: waiting })
		expect(refused).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		const later = await outcomeOf({ promise: link.engine() })
		expect(later).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('open')
	})

	it('a connected link whose engine is lost, its next engine refused for now (no host) → the waiting call refused, the next call asks the hub again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'engine-lost', project, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		hub.reply({
			type: 'open-refused',
			project,
			error: refusalData({ key: 'PROJECT_ENGINE_UNAVAILABLE' }),
		})
		const refused = await outcomeOf({ promise: waiting })
		expect(refused).toBe('PROJECT_ENGINE_UNAVAILABLE')
		void link.engine().catch(settleNothing)
		const askedAgain = await hub.next('open')
		expect(askedAgain.project).toBe(project)
	})

	it('a second link of a project in the realm on another version of the dialecte → refused PROJECT_DIALECTE_VERSION_MISMATCH, as another realm would be; the first link kept', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const first = openLink({ connection, project })
		await connectEngine({ hub, link: first, project })
		const other = connection.openProject({
			project,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: '9.9.9',
		})
		const refused = await outcomeOf({ promise: other.engine() })
		expect(refused).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		other.release()
		const afterRelease = await outcomeOf({ promise: other.engine() })
		expect(afterRelease).toBe('STORE_CLOSED')
		const kept = await outcomeOf({ promise: first.engine() })
		expect(kept).toBe('settled')
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('leave')
	})

	it('a second link of a project in the realm as another dialecte → refused PROJECT_DIALECTE_MISMATCH; on a closed connection, refused STORE_CLOSED first', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const project = uniqueProject()
		await connectEngine({ hub, link: openLink({ connection, project }), project })
		const otherDialecte = { project, dialecteId: 'other', dialecteVersion: TEST_DIALECTE.version }
		const refused = await outcomeOf({ promise: connection.openProject(otherDialecte).engine() })
		expect(refused).toBe('PROJECT_DIALECTE_MISMATCH')
		connection.close()
		const closed = await outcomeOf({ promise: connection.openProject(otherDialecte).engine() })
		expect(closed).toBe('STORE_CLOSED')
	})

	it('a destroy while another link of the realm has the project → refused PROJECT_OPEN_ELSEWHERE in the realm, the hub not asked', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		openLink({ connection, project })
		let destroyed = false
		const outcome = await outcomeOf({
			promise: connection.destroyProject({
				project,
				destroy: async function destroyFiles() {
					destroyed = true
				},
			}),
		})
		expect(outcome).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(destroyed).toBe(false)
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('destroy')
	})

	it('a link of the realm opened while the destroy waits for its grant → granted, the destroy refused PROJECT_OPEN_ELSEWHERE, nothing removed, the hub told it is done', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		let destroyed = false
		const destroying = outcomeOf({
			promise: connection.destroyProject({
				project,
				destroy: async function destroyFiles() {
					destroyed = true
				},
			}),
		})
		await hub.next('destroy')
		openLink({ connection, project })
		hub.reply({ type: 'destroy-granted', project })
		const outcome = await destroying
		expect(outcome).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(destroyed).toBe(false)
		const done = await hub.next('destroyed')
		expect(done.project).toBe(project)
	})

	it('its own link given, refused after the grant (another link of the realm opened meanwhile) → that link kept: it reaches the next engine, and the realm stays on the project once the other link goes', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const own = openLink({ connection, project })
		await connectEngine({ hub, link: own, project })
		let destroyed = false
		const destroying = outcomeOf({
			promise: connection.destroyProject({
				project,
				destroy: async function destroyFiles() {
					destroyed = true
				},
				own: { link: own, letGo: own.release },
			}),
		})
		await hub.next('destroy')
		const other = openLink({ connection, project })
		hub.reply({ type: 'engine-lost', project, generation: 1 })
		hub.reply({ type: 'destroy-granted', project })

		expect(await destroying).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(destroyed).toBe(false)
		await hub.next('destroyed')
		const reaching = own.engine()
		const channel = new MessageChannel()
		onTestFinished(function closeEnginePort() {
			channel.port2.close()
		})
		hub.reply({ type: 'engine-ready', project, generation: 2, port: channel.port1 }, [
			channel.port1,
		])
		expect(await outcomeOf({ promise: reaching })).toBe('settled')
		other.release()
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('leave')
	})

	it('its own link released while the grant is awaited, another link of the realm open → refused PROJECT_OPEN_ELSEWHERE after the grant, nothing removed', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const own = openLink({ connection, project })
		let destroyed = false
		const destroying = outcomeOf({
			promise: connection.destroyProject({
				project,
				destroy: async function destroyFiles() {
					destroyed = true
				},
				own: { link: own, letGo: own.release },
			}),
		})
		await hub.next('destroy')
		own.release()
		openLink({ connection, project })
		hub.reply({ type: 'destroy-granted', project })

		expect(await destroying).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(destroyed).toBe(false)
	})

	it('a project refused for now, its link kept → asked again when the page comes back, with no call waiting', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		const project = uniqueProject()
		const waiting = openLink({ connection, project }).engine()
		await hub.next('open')
		hub.reply({
			type: 'open-refused',
			project,
			error: toThrownData({
				thrown: createDialecteError('PROJECT_ENGINE_UNAVAILABLE', { detail: 'no host for now' }),
			}),
		})
		const outcome = await outcomeOf({ promise: waiting })
		expect(outcome).toBe('PROJECT_ENGINE_UNAVAILABLE')
		page.freeze()
		page.resume()
		const asked = await hub.next('open')
		expect(asked.project).toBe(project)
	})

	it('a destroy waiting for its grant when the page freezes → refused PROJECT_ENGINE_UNAVAILABLE; one asked while frozen → said once welcomed back', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		const project = uniqueProject()
		const first = connection.destroyProject({ project, destroy: settleNothing })
		await hub.next('destroy')
		page.freeze()
		const firstOutcome = await outcomeOf({ promise: first })
		expect(firstOutcome).toBe('PROJECT_ENGINE_UNAVAILABLE')
		let destroyed = false
		const second = connection.destroyProject({
			project,
			destroy: async function destroyFiles() {
				destroyed = true
			},
		})
		await pause({ ms: 50 })
		expect(hub.received).toEqual([])
		page.resume()
		const asked = await hub.next('destroy')
		expect(asked.project).toBe(project)
		hub.reply({ type: 'destroy-granted', project })
		const done = await hub.next('destroyed')
		expect(done.project).toBe(project)
		await second
		expect(destroyed).toBe(true)
	})

	it('a second destroy of a project from the same view while the first waits → refused PROJECT_OPEN_ELSEWHERE', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const project = uniqueProject()
		void connection.destroyProject({ project, destroy: settleNothing }).catch(settleNothing)
		await hub.next('destroy')
		const outcome = await outcomeOf({
			promise: connection.destroyProject({ project, destroy: settleNothing }),
		})
		expect(outcome).toBe('PROJECT_OPEN_ELSEWHERE')
	})

	it('a child port made while the page is frozen → bound once the realm is welcomed back', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		page.freeze()
		const handle = connection.createHubPort()
		await pause({ ms: 50 })
		expect(hub.received).toEqual([])
		page.resume()
		const bound = await hub.next('bind-child')
		expect(bound.port).toBeInstanceOf(MessagePort)
		handle.port.close()
	})

	it('a project opened by two realms → one engine, hosted by the first: a document one registers, the other reads', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub })
		const tab = await joinHub({ hub, spawners: [] })
		const project = uniqueProject()
		const shellLink = openLink({ connection: shell, project })
		await registerThrough({ link: shellLink })
		const tabLink = openLink({ connection: tab, project })
		const documents = await documentsThrough({ link: tabLink })
		expect(documents).toEqual([makeDocument()])
	})

	it('its host frozen → the other realm hosts the engine on the same files; the frozen one back → a new realm id, a client again', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, lifecycle: page })
		const project = uniqueProject()
		const shellLink = openLink({ connection: shell, project })
		await registerThrough({ link: shellLink })
		const tab = await joinHub({ hub })
		const tabLink = openLink({ connection: tab, project })
		await documentsThrough({ link: tabLink })
		const shellRealmBefore = shell.realmId()
		page.freeze()
		// the tab's next read waits for the hub's next engine: on the tab now
		const read = await documentsThrough({ link: tabLink }).catch(function readAgain() {
			return documentsThrough({ link: tabLink })
		})
		expect(read).toEqual([makeDocument()])
		page.resume()
		const back = await documentsThrough({ link: shellLink })
		expect(back).toEqual([makeDocument()])
		expect(shell.realmId()).not.toBe(shellRealmBefore)
	})

	it('frozen again while it says hello → that hello dropped, its lock let go; back once more → a client again', async () => {
		const realmLocksBefore = await countRealmLocks()
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, lifecycle: page })
		const project = uniqueProject()
		const shellLink = openLink({ connection: shell, project })
		await registerThrough({ link: shellLink })
		const tab = await joinHub({ hub })
		openLink({ connection: tab, project })
		page.freeze()
		// the realm waits for its lock before its hello: frozen again in between
		page.resume()
		page.freeze()
		page.resume()
		const back = await documentsThrough({ link: shellLink })
		expect(back).toEqual([makeDocument()])
		const realmLocksAfter = await countRealmLocks()
		expect(realmLocksAfter).toBe(realmLocksBefore + 2)
	})

	it('a child realm joining through a port its parent made → a client of the project’s engine; unbound → answered no more', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub })
		const project = uniqueProject()
		const other = uniqueProject()
		await registerThrough({ link: openLink({ connection: shell, project }) })
		// an engine ready for the other project: a bound child would be answered at once
		await documentsThrough({ link: openLink({ connection: shell, project: other }) })
		const handle = shell.createHubPort()
		const child = await startHubConnection({
			openPort: function boundPort() {
				return { port: handle.port }
			},
			topLevel: false,
			spawners: [],
			holdsLock: false,
			lifecycle: undefined,
		})
		const documents = await documentsThrough({ link: openLink({ connection: child, project }) })
		expect(documents).toEqual([makeDocument()])
		handle.unbind()
		await pause({ ms: 100 })
		const outcome = await outcomeOf({
			promise: openLink({ connection: child, project: other }).engine(),
			withinMs: 1_000,
		})
		expect(outcome).toBe('pending')
	})

	it('the page into the back/forward cache → its engines ended, the other realm hosts; back from it → a new realm id, a client again', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, lifecycle: page })
		const project = uniqueProject()
		const shellLink = openLink({ connection: shell, project })
		await registerThrough({ link: shellLink })
		const tab = await joinHub({ hub })
		const tabLink = openLink({ connection: tab, project })
		await documentsThrough({ link: tabLink })
		const shellRealmBefore = shell.realmId()
		page.hide({ persisted: true })
		const read = await documentsThrough({ link: tabLink }).catch(function readAgain() {
			return documentsThrough({ link: tabLink })
		})
		expect(read).toEqual([makeDocument()])
		page.show()
		const back = await documentsThrough({ link: shellLink })
		expect(back).toEqual([makeDocument()])
		expect(shell.realmId()).not.toBe(shellRealmBefore)
	})

	it('the page going away for good → the engines it hosts ended: their lock let go', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, lifecycle: page })
		const project = uniqueProject()
		await registerThrough({ link: openLink({ connection: shell, project }) })
		const heldBefore = await isEngineLockFree({ project })
		expect(heldBefore).toBe(false)
		page.hide({ persisted: false })
		await expect
			.poll(function engineLockFree() {
				return isEngineLockFree({ project })
			})
			.toBe(true)
	})
})

/** The link asks, the fake hub hands it an engine port (generation 1): the link's engine is a client on it. */
async function connectEngine(params: {
	hub: FakeHub
	link: HubProjectLink
	project: string
}): Promise<void> {
	const { hub, link, project } = params
	const connecting = link.engine()
	await hub.next('open')
	const channel = new MessageChannel()
	onTestFinished(function closeEnginePort() {
		channel.port2.close()
	})
	hub.reply({ type: 'engine-ready', project, generation: 1, port: channel.port1 }, [channel.port1])
	await connecting
}

/** Once the link has heard its engine is lost: a call for its engine waits (it answered at once before). */
async function engineLostHeard(params: { link: HubProjectLink }): Promise<void> {
	await vi.waitFor(async function engineDropped() {
		const outcome = await outcomeOf({ promise: params.link.engine(), withinMs: 20 })
		expect(outcome).toBe('pending')
	})
}

/** A hub refusal of that key, as the hub sends it. */
function refusalData(params: { key: DialecteErrorKey }): ThrownData {
	return toThrownData({
		thrown: createDialecteError(params.key, { detail: 'refused by the case' }),
	})
}

function typeOfMessage(message: RealmToHubMessage): string {
	return message.type
}

function keyOfThrown(params: { data: HubToRealmMessage }): string | undefined {
	const { data } = params
	if (data.type !== 'hello-refused') return undefined
	return toDialecteError(fromThrownData({ data: data.error }))?.key
}

function refuseAll(): boolean {
	return true
}

/** The second hello left unanswered (the hub could not be reached when the page came back). */
function silenceSecond(helloIndex: number): boolean {
	return helloIndex === 1
}

/** The first hello welcomed, every later one refused (the page came back to a hub of another version). */
function refuseAfterFirst(helloIndex: number): boolean {
	return helloIndex > 0
}

async function settleNothing(): Promise<void> {}
