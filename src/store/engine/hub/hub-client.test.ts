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
import {
	HUB_REGISTRY_KEY,
	HUB_REJOIN_FIRST_DELAY_MS,
	HUB_WELCOME_BUDGET_MS,
} from './hub-client.constants'
import { connectHub } from './hub-public'
import { serveHub } from './hub-shell'
import { HUB_LOCK_PREFIX, HUB_PROTOCOL_VERSION, REALM_LOCK_PREFIX } from './hub.constants'
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

/**
 * A realm of this page connected to `hub` through a relay that holds what the realm says for `delayMs` (a port slow
 * on its way to the hub); what the hub says reaches it at once.
 */
function joinDelayedHub(params: { hub: HubShell; delayMs: number }): Promise<HubConnection> {
	const { hub, delayMs } = params
	return startHubConnection({
		openPort: function delayedPort() {
			const realmSide = new MessageChannel()
			const hubSide = new MessageChannel()
			hub.connect({ port: hubSide.port2 })
			realmSide.port2.onmessage = function holdThenPass(event: MessageEvent) {
				setTimeout(function pass() {
					hubSide.port1.postMessage(event.data, [...event.ports])
				}, delayMs)
			}
			hubSide.port1.onmessage = function passAtOnce(event: MessageEvent) {
				realmSide.port2.postMessage(event.data, [...event.ports])
			}
			onTestFinished(function closeRelay() {
				realmSide.port2.close()
				hubSide.port1.close()
			})
			return { port: realmSide.port1 }
		},
		topLevel: true,
		spawners: [SPAWNER],
		holdsLock: true,
		lifecycle: undefined,
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
	/** Said to the realm on the port it opened at that rank (from 0). */
	replyOn: (params: { portIndex: number; message: HubToRealmMessage }) => void
	/** The hub gone: the lock it named in its welcomes let go. */
	end: () => void
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
	// the lock a hub holds for its life, named in its welcomes
	const hubLock = `${HUB_LOCK_PREFIX}fake-${crypto.randomUUID()}`
	let endHub: () => void = refuseNone
	void navigator.locks.request(hubLock, function holdWhileTheHubLives() {
		return new Promise<void>(function untilEnded(release) {
			endHub = release
		})
	})
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
					: { type: 'welcome', realmId: message.realmId, hubLock }
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
		replyOn: function replyOnPort({ portIndex, message }) {
			ports[portIndex]?.postMessage(message)
		},
		end: function endFakeHub() {
			endHub()
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

	it('connected twice, from any copy of the library → one connection, kept under the protocol’s key; the page holds its realm id, child ports and its rejoin listeners only', async () => {
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
		expect(Object.keys(realm ?? {}).toSorted()).toEqual(['createHubPort', 'onRejoined', 'realmId'])
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

	it('a child already connected adopting another port → kept for its next join, the connection it has answered; a later port lets it go, and closing the connection the last', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const first = await adoptHubConnection({ port: hub.openPort() })
		const spare = new MessageChannel()
		const later = new MessageChannel()
		onTestFinished(function closeSpares() {
			spare.port2.close()
			later.port2.close()
		})
		const spareClosed = vi.spyOn(spare.port1, 'close')
		const laterClosed = vi.spyOn(later.port1, 'close')
		const second = await adoptHubConnection({ port: spare.port1 })
		expect(second).toBe(first)
		expect(spareClosed).not.toHaveBeenCalled()
		await adoptHubConnection({ port: later.port1 })
		expect(spareClosed).toHaveBeenCalled()
		first!.close()
		expect(laterClosed).toHaveBeenCalled()
	})

	it('a page’s connection handed a port → that port closed, the connection answered', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const page = await joinFakeHub({ hub })
		onTestFinished(page.close)
		;(globalThis as unknown as Record<symbol, unknown>)[HUB_REGISTRY_KEY] = Promise.resolve(page)
		const spare = new MessageChannel()
		onTestFinished(function closeSpare() {
			spare.port2.close()
		})
		const closeSpy = vi.spyOn(spare.port1, 'close')
		const answered = await adoptHubConnection({ port: spare.port1 })
		expect(answered).toBe(page)
		expect(closeSpy).toHaveBeenCalled()
	})

	it('a child told `dropped` → its call in flight and its waiting call refused STORE_ENGINE_LOST realm-dropped, a later call the same', async () => {
		const hub = fakeHub()
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		const client = await link.engine()
		const inFlight = lostReasonOf({ promise: client.api.getDocuments() })
		const waiting = lostReasonOf({
			promise: openLink({ connection: child, project: uniqueProject() }).engine(),
		})
		await hub.next('open')
		hub.reply({ type: 'dropped' })
		expect(await inFlight).toBe('realm-dropped')
		expect(await waiting).toBe('realm-dropped')
		const later = await lostReasonOf({ promise: link.engine() })
		expect(later).toBe('realm-dropped')
	})

	it('a dropped child adopting a new port → the same connection joins as a new realm id, a link opened before asked for again, no second connection', async () => {
		withEmptyRegistry()
		const hub = fakeHub()
		const adopted = await adoptHubConnection({ port: hub.openPort() })
		onTestFinished(adopted!.close)
		const project = uniqueProject()
		const link = openLink({ connection: adopted!, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'dropped' })
		await vi.waitFor(async function dropped() {
			expect(await lostReasonOf({ promise: link.engine() })).toBe('realm-dropped')
		})
		const again = await adoptHubConnection({ port: hub.openPort() })
		expect(again).toBe(adopted)
		await vi.waitFor(function helloAgain() {
			expect(hub.hellos).toHaveLength(2)
		})
		expect(hub.hellos[1]!.realmId).not.toBe(hub.hellos[0]!.realmId)
		expect(adopted!.realmId()).toBe(hub.hellos[1]!.realmId)
		await connectEngine({ hub, link, project })
	})

	it('a child handed a new port before it is told `dropped` → once dropped, it joins again on that port at once', async () => {
		const hub = fakeHub()
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		expect(child.adoptPort({ port: hub.openPort() })).toBe(true)
		await pause({ ms: 100 })
		expect(hub.hellos).toHaveLength(1)
		hub.replyOn({ portIndex: 0, message: { type: 'dropped' } })
		await vi.waitFor(function helloOnTheNewPort() {
			expect(hub.hellos).toHaveLength(2)
		})
		await connectEngine({ hub, link, project })
	})

	it('a dropped child whose new port is refused (its parent gone before the hello) → dropped still: refused realm-dropped, the next port binds it', async () => {
		const hub = fakeHub({ refuses: refuseSecond })
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'dropped' })
		await vi.waitFor(async function dropped() {
			expect(await lostReasonOf({ promise: link.engine() })).toBe('realm-dropped')
		})
		child.adoptPort({ port: hub.openPort() })
		await vi.waitFor(function secondHelloSaid() {
			expect(hub.hellos).toHaveLength(2)
		})
		await vi.waitFor(async function droppedStill() {
			expect(await lostReasonOf({ promise: link.engine() })).toBe('realm-dropped')
		})
		// the hub's refusal kept as why
		const refused = await link.engine().catch(function keepThrown(thrown: unknown) {
			return thrown
		})
		expect(toDialecteError(refused)?.cause).toMatchObject({
			cause: { key: 'STORE_PROTOCOL_MISMATCH' },
		})
		child.adoptPort({ port: hub.openPort() })
		await connectEngine({ hub, link, project })
		expect(hub.hellos).toHaveLength(3)
	})

	it('a realm of its own that is not top-level (an iframe that connected itself), unanswered when it comes back → it tries again on its own, not dropped', async () => {
		const hub = fakeHub({ silences: silenceSecond })
		const page = fakePage()
		const frame = await startHubConnection({
			openPort: function fakeHubPort() {
				return { port: hub.openPort() }
			},
			topLevel: false,
			spawners: [SPAWNER],
			holdsLock: true,
			lifecycle: page,
			welcomeBudgetMs: 300,
		})
		onTestFinished(frame.close)
		page.freeze()
		page.resume()
		await vi.waitFor(
			function helloAgainOnItsOwn() {
				expect(hub.hellos).toHaveLength(3)
			},
			{ timeout: 5_000 },
		)
		const handed = new MessageChannel()
		onTestFinished(function closeHanded() {
			handed.port2.close()
		})
		expect(frame.adoptPort({ port: handed.port1 })).toBe(false)
	})

	it('a bound child joining on a handed port that gets a newer one → it leaves that join and joins on the newer port at once', async () => {
		const hub = fakeHub({ silences: silenceSecond })
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'dropped' })
		await vi.waitFor(async function dropped() {
			expect(await lostReasonOf({ promise: link.engine() })).toBe('realm-dropped')
		})
		child.adoptPort({ port: hub.openPort() })
		await vi.waitFor(function silentHelloSaid() {
			expect(hub.hellos).toHaveLength(2)
		})
		const handedAt = performance.now()
		child.adoptPort({ port: hub.openPort() })
		await connectEngine({ hub, link, project })
		expect(hub.hellos).toHaveLength(3)
		expect(performance.now() - handedAt).toBeLessThan(HUB_WELCOME_BUDGET_MS / 2)
	})

	it('a port a bound child lets go unused (a newer one handed) → the hub told it is unused before it closes', async () => {
		const hub = fakeHub()
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const unused = new MessageChannel()
		onTestFinished(function closeUnused() {
			unused.port2.close()
		})
		const heard: unknown[] = []
		unused.port2.onmessage = function hear(event) {
			heard.push(event.data)
		}
		child.adoptPort({ port: unused.port1 })
		const newer = new MessageChannel()
		onTestFinished(function closeNewer() {
			newer.port2.close()
		})
		child.adoptPort({ port: newer.port1 })
		await vi.waitFor(function told() {
			expect(heard).toEqual([{ type: 'port-unused' }])
		})
	})

	it('a dropped child whose new port stays silent → dropped again once the welcome budget has passed, no hello said again on its own', async () => {
		const hub = fakeHub({ silences: silenceSecond })
		const child = await joinFakeHubAsChild({ hub, welcomeBudgetMs: 300 })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'dropped' })
		await vi.waitFor(async function dropped() {
			expect(await lostReasonOf({ promise: link.engine() })).toBe('realm-dropped')
		})
		child.adoptPort({ port: hub.openPort() })
		const waiting = lostReasonOf({ promise: link.engine() })
		expect(await waiting).toBe('realm-dropped')
		await pause({ ms: 1_500 })
		expect(hub.hellos).toHaveLength(2)
	})

	it('a child told `dropped` while a destroy waits for its grant → that destroy refused realm-dropped', async () => {
		const hub = fakeHub()
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const destroying = lostReasonOf({
			promise: child.destroyProject({
				project,
				dialecteId: TEST_DIALECTE.id,
				destroy: settleNothing,
			}),
		})
		await hub.next('destroy')
		hub.reply({ type: 'dropped' })
		expect(await destroying).toBe('realm-dropped')
	})

	it('a port handed while the realm’s first attempt fails → the next attempt joins on that port', async () => {
		withEmptyRegistry()
		const hub = fakeHub({ refuses: refuseFirst })
		const first = adoptHubConnection({ port: hub.openPort() })
		const second = adoptHubConnection({ port: hub.openPort() })
		expect(await outcomeOf({ promise: first })).toBe('STORE_PROTOCOL_MISMATCH')
		const connection = await second
		onTestFinished(connection!.close)
		expect(hub.hellos).toHaveLength(2)
		expect(connection!.realmId()).toBe(hub.hellos[1]!.realmId)
	})

	it('a page suspended during its first hello, then welcomed → its rejoin listeners not called: that is its first welcome', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connecting = startHubConnection({
			openPort: function fakeHubPort() {
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [SPAWNER],
			holdsLock: true,
			lifecycle: page,
		})
		page.freeze()
		const connection = await connecting
		onTestFinished(connection.close)
		let calls = 0
		connection.onRejoined(function countRejoin() {
			calls += 1
		})
		// a link in use: once welcomed, the realm asks the hub for its engine - the proof it joined
		openLink({ connection, project: uniqueProject() })
		page.resume()
		await hub.next('open')
		await pause({ ms: 0 })
		expect(calls).toBe(0)
		page.freeze()
		page.resume()
		await vi.waitFor(
			function welcomedBack() {
				expect(calls).toBe(1)
			},
			{ timeout: 5_000 },
		)
	})

	it('a rejoin listener unsubscribing another before it is called → that other one not called', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		onTestFinished(connection.close)
		let firstCalls = 0
		let laterCalls = 0
		let stopLater: () => void = function stopNothing() {}
		// the listeners run in the order they were added: the first stops the later one
		connection.onRejoined(function stopTheOther() {
			firstCalls += 1
			stopLater()
		})
		stopLater = connection.onRejoined(function countLater() {
			laterCalls += 1
		})
		page.freeze()
		page.resume()
		await vi.waitFor(function firstCalled() {
			expect(firstCalls).toBe(1)
		})
		await pause({ ms: 50 })
		expect(laterCalls).toBe(0)
	})

	it('onRejoined → called once the page is welcomed back after a resume; not on its first join nor while it says hello; unsubscribed → not again', async () => {
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
			welcomeBudgetMs: 300,
		})
		onTestFinished(connection.close)
		let calls = 0
		const stop = connection.onRejoined(function countRejoin() {
			calls += 1
		})
		await pause({ ms: 50 })
		expect(calls).toBe(0)
		page.freeze()
		page.resume()
		// the second hello unanswered: no welcome, no call; the page tries again after a while, welcomed
		await vi.waitFor(function secondHelloSaid() {
			expect(hub.hellos).toHaveLength(2)
		})
		await pause({ ms: 100 })
		expect(calls).toBe(0)
		await vi.waitFor(
			function welcomedBack() {
				expect(calls).toBe(1)
			},
			{ timeout: 5_000 },
		)
		stop()
		page.freeze()
		page.resume()
		await vi.waitFor(function fourthHelloSaid() {
			expect(hub.hellos).toHaveLength(4)
		})
		await pause({ ms: 100 })
		expect(calls).toBe(1)
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

	it('a link released → resolved once the hub said the realm left (it counts no more there); with another link of the realm, or never asked of the hub, at once', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const first = openLink({ connection, project })
		const second = openLink({ connection, project })
		await connectEngine({ hub, link: first, project })
		await second.release()
		let released = false
		void first.release().then(function markReleased() {
			released = true
		})
		await hub.next('leave')
		await pause({ ms: 50 })
		expect(released).toBe(false)
		hub.reply({ type: 'left', project, dialecteId: TEST_DIALECTE.id })
		await expect
			.poll(function isReleased() {
				return released
			})
			.toBe(true)
		const never = openLink({ connection, project: uniqueProject() })
		await never.release()
	})

	it('a realm whose leave reaches the hub late, another realm destroying once that release settled → the destroy granted: the release waited for the hub to hear the leave', async () => {
		const hub = serveHub()
		const project = uniqueProject()
		const late = await joinDelayedHub({ hub, delayMs: 300 })
		onTestFinished(late.close)
		const other = await joinHub({ hub })
		onTestFinished(other.close)
		const link = late.openProject({
			project,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion: TEST_DIALECTE.version,
		})
		await link.engine()
		await link.release()
		let destroyed = false
		await other.destroyProject({
			project,
			dialecteId: TEST_DIALECTE.id,
			destroy: async function destroyFiles() {
				destroyed = true
			},
		})
		expect(destroyed).toBe(true)
	})

	it('a link released, the leave unanswered, the page frozen → resolved: a realm instance gone counts no more', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		const releasing = link.release()
		await hub.next('leave')
		page.freeze()
		await releasing
	})

	it('a connection closed while it uses a project → the hub told it leaves the project (a bound child has no lock whose end would say so)', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		connection.close()
		const left = await hub.next('leave')
		expect(left).toMatchObject({ type: 'leave', project, dialecteId: TEST_DIALECTE.id })
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
		hub.reply({ type: 'engine-lost', project, dialecteId: TEST_DIALECTE.id, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		hub.reply({
			type: 'open-refused',
			project,
			dialecteId: TEST_DIALECTE.id,
			error: refusalData({ key: 'PROJECT_DIALECTE_VERSION_MISMATCH' }),
		})
		const refused = await outcomeOf({ promise: waiting })
		expect(refused).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		const later = await outcomeOf({ promise: link.engine() })
		expect(later).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		await pause({ ms: 50 })
		expect(hub.received.map(typeOfMessage)).not.toContain('open')
	})

	it('a link the hub refuses PROJECT_NAME_INVALID → every later call refused so, the hub not asked again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		const waiting = link.engine()
		await hub.next('open')
		hub.reply({
			type: 'open-refused',
			project,
			dialecteId: TEST_DIALECTE.id,
			error: refusalData({ key: 'PROJECT_NAME_INVALID' }),
		})
		expect(await outcomeOf({ promise: waiting })).toBe('PROJECT_NAME_INVALID')
		const opens = hub.received.filter(isOpen).length
		expect(await outcomeOf({ promise: link.engine() })).toBe('PROJECT_NAME_INVALID')
		await pause({ ms: 50 })
		expect(hub.received.filter(isOpen)).toHaveLength(opens)
	})

	it('the hub gone (its lock let go) → the realm’s calls refused STORE_CONNECTION_FAILED meanwhile, and it says hello again, as a new instance', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.end()
		await vi.waitFor(async function refusedMeanwhile() {
			expect(await outcomeOf({ promise: link.engine() })).toBe('STORE_CONNECTION_FAILED')
		})
		await vi.waitFor(
			function saysHelloAgain() {
				expect(hub.hellos).toHaveLength(2)
			},
			{ timeout: HUB_REJOIN_FIRST_DELAY_MS * 3 },
		)
		expect(hub.hellos[1]!.realmId).not.toBe(hub.hellos[0]!.realmId)
	})

	it('a realm whose lock the browser refuses, or never grants within the welcome budget → its join fails STORE_CONNECTION_FAILED', async () => {
		const request = navigator.locks.request.bind(navigator.locks)
		for (const shape of ['refused', 'never'] as const) {
			const spy = vi.spyOn(navigator.locks, 'request').mockImplementation(function realmLockShaped(
				name: string,
				...rest: unknown[]
			) {
				if (!name.startsWith(REALM_LOCK_PREFIX))
					return (request as (...args: unknown[]) => Promise<unknown>)(name, ...rest)
				return shape === 'refused'
					? Promise.reject(new DOMException('not fully active', 'InvalidStateError'))
					: new Promise<never>(function neverGranted() {})
			} as typeof navigator.locks.request)
			const hub = fakeHub()
			const joining = startHubConnection({
				openPort: function fakeHubPort() {
					return { port: hub.openPort() }
				},
				topLevel: true,
				spawners: [SPAWNER],
				holdsLock: true,
				lifecycle: undefined,
				welcomeBudgetMs: 200,
			})
			expect(await outcomeOf({ promise: joining }), shape).toBe('STORE_CONNECTION_FAILED')
			spy.mockRestore()
		}
	})

	it('a bound child whose leave is never acknowledged (its hub gone), handed a new port by its page → the leave settled: it counts there no more', async () => {
		const hub = fakeHub()
		const child = await joinFakeHubAsChild({ hub })
		onTestFinished(child.close)
		const project = uniqueProject()
		const link = openLink({ connection: child, project })
		await connectEngine({ hub, link, project })
		let released = false
		void link.release().then(function markReleased() {
			released = true
		})
		await hub.next('leave')
		await pause({ ms: 50 })
		expect(released).toBe(false)
		child.adoptPort({ port: hub.openPort() })
		await vi.waitFor(function leaveSettled() {
			expect(released).toBe(true)
		})
	})

	it('a page frozen while its first join waits for its lock, the budget passed meanwhile → not refused: back, it joins as a new instance', async () => {
		const request = navigator.locks.request.bind(navigator.locks)
		const withheld = new Set<string>()
		const spy = vi
			.spyOn(navigator.locks, 'request')
			.mockImplementation(function firstRealmLockWithheld(name: string, ...rest: unknown[]) {
				// the first realm instance's lock is never granted; any later one is
				if (name.startsWith(REALM_LOCK_PREFIX) && withheld.size === 0) {
					withheld.add(name)
					return new Promise<never>(function neverGranted() {})
				}
				return (request as (...args: unknown[]) => Promise<unknown>)(name, ...rest)
			} as typeof navigator.locks.request)
		onTestFinished(function restoreLocks() {
			spy.mockRestore()
		})
		const hub = fakeHub()
		const page = fakePage()
		const connecting = startHubConnection({
			openPort: function fakeHubPort() {
				return { port: hub.openPort() }
			},
			topLevel: true,
			spawners: [SPAWNER],
			holdsLock: true,
			lifecycle: page,
			welcomeBudgetMs: 100,
		})
		page.freeze()
		await pause({ ms: 200 })
		const connection = await connecting
		onTestFinished(connection.close)
		page.resume()
		await vi.waitFor(function joinedBack() {
			expect(hub.hellos).toHaveLength(1)
		})
		expect(withheld.has(`${REALM_LOCK_PREFIX}${hub.hellos[0]!.realmId}`)).toBe(false)
	})

	it('a page back from a freeze → each link asks for its project again with the creation id it had', async () => {
		const hub = fakeHub()
		const page = fakePage()
		const connection = await joinFakeHub({ hub, page })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		page.freeze()
		page.resume()
		void link.engine().catch(function leftWaiting() {})
		const asked = await hub.next('open')
		expect(asked).toMatchObject({ project, expectedCreationId: 'creation-1' })
	})

	it('a connected link whose next engine runs another creation of the project (destroyed and made again) → refused PROJECT_DESTROYED_WHILE_AWAY for good, the project left', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'engine-lost', project, dialecteId: TEST_DIALECTE.id, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		const channel = new MessageChannel()
		hub.reply(
			{
				type: 'engine-ready',
				creationId: 'creation-2',
				project,
				dialecteId: TEST_DIALECTE.id,
				generation: 2,
				port: channel.port1,
			},
			[channel.port1],
		)
		expect(await outcomeOf({ promise: waiting })).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		const left = await hub.next('leave')
		expect(left).toMatchObject({ project, dialecteId: TEST_DIALECTE.id })
		expect(await outcomeOf({ promise: link.engine() })).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		channel.port2.close()
	})

	it('a link refused PROJECT_DESTROYED_WHILE_AWAY, still held → a fresh link of the realm asks the hub expecting nothing and reaches the project made again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'engine-lost', project, dialecteId: TEST_DIALECTE.id, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		const away = new MessageChannel()
		hub.reply(
			{
				type: 'engine-ready',
				creationId: 'creation-2',
				project,
				dialecteId: TEST_DIALECTE.id,
				generation: 2,
				port: away.port1,
			},
			[away.port1],
		)
		expect(await outcomeOf({ promise: waiting })).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		away.port2.close()
		// the refused link not released: a second Project of the page opens the project
		const fresh = openLink({ connection, project })
		const reaching = fresh.engine()
		const asked = await hub.next('open')
		expect(asked).toMatchObject({ project })
		expect(asked).not.toHaveProperty('expectedCreationId')
		const channel = new MessageChannel()
		onTestFinished(function closeFreshPort() {
			channel.port2.close()
		})
		hub.reply(
			{
				type: 'engine-ready',
				creationId: 'creation-2',
				project,
				dialecteId: TEST_DIALECTE.id,
				generation: 2,
				port: channel.port1,
			},
			[channel.port1],
		)
		expect(await outcomeOf({ promise: reaching })).toBe('settled')
		expect(await outcomeOf({ promise: link.engine() })).toBe('PROJECT_DESTROYED_WHILE_AWAY')
	})

	it('a bound child’s link released, its hub saying nothing more (gone, no new port) → the release settles within the welcome budget', async () => {
		const { releasing } = await releasedChildLink({ hub: fakeHub() })
		expect(await outcomeOf({ promise: releasing, withinMs: 1_000 })).toBe('settled')
	})

	it('a connected link whose engine is lost, its next engine refused for now (no host) → the waiting call refused, the next call asks the hub again', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		onTestFinished(connection.close)
		const project = uniqueProject()
		const link = openLink({ connection, project })
		await connectEngine({ hub, link, project })
		hub.reply({ type: 'engine-lost', project, dialecteId: TEST_DIALECTE.id, generation: 1 })
		await engineLostHeard({ link })
		const waiting = link.engine()
		hub.reply({
			type: 'open-refused',
			project,
			dialecteId: TEST_DIALECTE.id,
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

	it('a second link of the project’s name in the realm under another dialecte → another project, asked of the hub apart; under another version → refused PROJECT_DIALECTE_VERSION_MISMATCH; on a closed connection, refused STORE_CLOSED first', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const project = uniqueProject()
		await connectEngine({ hub, link: openLink({ connection, project }), project })
		const otherDialecte = { project, dialecteId: 'other', dialecteVersion: TEST_DIALECTE.version }
		void connection
			.openProject(otherDialecte)
			.engine()
			.catch(function leftWaiting() {})
		const asked = await hub.next('open')
		expect(asked).toMatchObject({ type: 'open', project, dialecteId: 'other' })
		const otherVersion = { project, dialecteId: TEST_DIALECTE.id, dialecteVersion: '9.9.9' }
		const refused = await outcomeOf({ promise: connection.openProject(otherVersion).engine() })
		expect(refused).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
		connection.close()
		const closed = await outcomeOf({ promise: connection.openProject(otherVersion).engine() })
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
				dialecteId: TEST_DIALECTE.id,
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
				dialecteId: TEST_DIALECTE.id,
				destroy: async function destroyFiles() {
					destroyed = true
				},
			}),
		})
		await hub.next('destroy')
		openLink({ connection, project })
		hub.reply({ type: 'destroy-granted', project, dialecteId: TEST_DIALECTE.id })
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
				dialecteId: TEST_DIALECTE.id,
				destroy: async function destroyFiles() {
					destroyed = true
				},
				own: { link: own, letGo: own.release },
			}),
		})
		await hub.next('destroy')
		const other = openLink({ connection, project })
		hub.reply({ type: 'engine-lost', project, dialecteId: TEST_DIALECTE.id, generation: 1 })
		hub.reply({ type: 'destroy-granted', project, dialecteId: TEST_DIALECTE.id })

		expect(await destroying).toBe('PROJECT_OPEN_ELSEWHERE')
		expect(destroyed).toBe(false)
		await hub.next('destroyed')
		const reaching = own.engine()
		const channel = new MessageChannel()
		onTestFinished(function closeEnginePort() {
			channel.port2.close()
		})
		hub.reply(
			{
				type: 'engine-ready',
				creationId: 'creation-1',
				project,
				dialecteId: TEST_DIALECTE.id,
				generation: 2,
				port: channel.port1,
			},
			[channel.port1],
		)
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
				dialecteId: TEST_DIALECTE.id,
				destroy: async function destroyFiles() {
					destroyed = true
				},
				own: { link: own, letGo: own.release },
			}),
		})
		await hub.next('destroy')
		own.release()
		openLink({ connection, project })
		hub.reply({ type: 'destroy-granted', project, dialecteId: TEST_DIALECTE.id })

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
			dialecteId: TEST_DIALECTE.id,
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
		const first = connection.destroyProject({
			project,
			dialecteId: TEST_DIALECTE.id,
			destroy: settleNothing,
		})
		await hub.next('destroy')
		page.freeze()
		const firstOutcome = await outcomeOf({ promise: first })
		expect(firstOutcome).toBe('PROJECT_ENGINE_UNAVAILABLE')
		let destroyed = false
		const second = connection.destroyProject({
			project,
			dialecteId: TEST_DIALECTE.id,
			destroy: async function destroyFiles() {
				destroyed = true
			},
		})
		await pause({ ms: 50 })
		expect(hub.received).toEqual([])
		page.resume()
		const asked = await hub.next('destroy')
		expect(asked.project).toBe(project)
		hub.reply({ type: 'destroy-granted', project, dialecteId: TEST_DIALECTE.id })
		const done = await hub.next('destroyed')
		expect(done.project).toBe(project)
		await second
		expect(destroyed).toBe(true)
	})

	it('a second destroy of a project from the same view while the first waits → refused PROJECT_OPEN_ELSEWHERE', async () => {
		const hub = fakeHub()
		const connection = await joinFakeHub({ hub })
		const project = uniqueProject()
		void connection
			.destroyProject({ project, dialecteId: TEST_DIALECTE.id, destroy: settleNothing })
			.catch(settleNothing)
		await hub.next('destroy')
		const outcome = await outcomeOf({
			promise: connection.destroyProject({
				project,
				dialecteId: TEST_DIALECTE.id,
				destroy: settleNothing,
			}),
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

	it('a child realm joining through a port its parent made → a client of the project’s engine; unbound → refused STORE_ENGINE_LOST realm-dropped', async () => {
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
			bound: true,
		})
		const documents = await documentsThrough({ link: openLink({ connection: child, project }) })
		expect(documents).toEqual([makeDocument()])
		handle.unbind()
		await vi.waitFor(
			async function childDropped() {
				const reason = await lostReasonOf({
					promise: openLink({ connection: child, project: other }).engine(),
				})
				expect(reason).toBe('realm-dropped')
			},
			{ timeout: 5_000 },
		)
	})

	it('a page with a bound child frozen, then resumed → the child’s call refused realm-dropped; bound again from onRejoined, it reads the project', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, lifecycle: page })
		const project = uniqueProject()
		await registerThrough({ link: openLink({ connection: shell, project }) })
		const child = await startHubConnection({
			openPort: function boundPort() {
				return { port: shell.createHubPort().port }
			},
			topLevel: false,
			spawners: [],
			holdsLock: false,
			lifecycle: undefined,
			bound: true,
		})
		onTestFinished(child.close)
		const childLink = openLink({ connection: child, project })
		await documentsThrough({ link: childLink })
		const stop = shell.onRejoined(function bindChildAgain() {
			child.adoptPort({ port: shell.createHubPort().port })
		})
		onTestFinished(stop)
		page.freeze()
		await vi.waitFor(
			async function childDropped() {
				const reason = await lostReasonOf({ promise: documentsThrough({ link: childLink }) })
				expect(reason).toBe('realm-dropped')
			},
			{ timeout: 5_000 },
		)
		page.resume()
		await vi.waitFor(
			async function childBackOnTheProject() {
				const documents = await documentsThrough({ link: childLink })
				expect(documents).toEqual([makeDocument()])
			},
			{ timeout: 10_000 },
		)
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

/** A child realm on a fake hub: no lock of its own, no lifecycle, joined through the hub's port. */
/** A bound child released while its hub says nothing (a hub that died): settled within the welcome budget. */
async function releasedChildLink(params: { hub: FakeHub }): Promise<{ releasing: Promise<void> }> {
	const { hub } = params
	const connection = await joinFakeHubAsChild({ hub, welcomeBudgetMs: 200 })
	onTestFinished(connection.close)
	const project = uniqueProject()
	const link = openLink({ connection, project })
	await connectEngine({ hub, link, project })
	const releasing = link.release()
	await hub.next('leave')
	return { releasing }
}

function joinFakeHubAsChild(params: {
	hub: FakeHub
	welcomeBudgetMs?: number
}): Promise<HubConnection> {
	return startHubConnection({
		openPort: function fakeHubPort() {
			return { port: params.hub.openPort() }
		},
		topLevel: false,
		spawners: [],
		holdsLock: false,
		lifecycle: undefined,
		welcomeBudgetMs: params.welcomeBudgetMs,
		bound: true,
	})
}

/** Why a call was refused `STORE_ENGINE_LOST` (its `meta.reason`), or what else it settled with. */
async function lostReasonOf(params: { promise: Promise<unknown> }): Promise<unknown> {
	try {
		await params.promise
		return 'resolved'
	} catch (thrown) {
		const error = toDialecteError(thrown)
		return error?.key === 'STORE_ENGINE_LOST' ? error.meta?.reason : error?.key
	}
}

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
	hub.reply(
		{
			type: 'engine-ready',
			creationId: 'creation-1',
			project,
			dialecteId: TEST_DIALECTE.id,
			generation: 1,
			port: channel.port1,
		},
		[channel.port1],
	)
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

function isOpen(message: RealmToHubMessage): boolean {
	return message.type === 'open'
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
function refuseFirst(helloIndex: number): boolean {
	return helloIndex === 0
}

function refuseSecond(helloIndex: number): boolean {
	return helloIndex === 1
}

function refuseAfterFirst(helloIndex: number): boolean {
	return helloIndex > 0
}

async function settleNothing(): Promise<void> {}
