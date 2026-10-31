import { fromThrownData } from '../wire/error-envelope'
import { serveHub } from './hub-shell'
import {
	ENGINE_IDLE_CLOSE_MS,
	HUB_OPEN_BUDGET_MS,
	HUB_PROTOCOL_VERSION,
	REALM_LOCK_PREFIX,
} from './hub.constants'

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { toDialecteError } from '@/errors'

import type { HubToRealmMessage, RealmToHubMessage } from './hub-protocol.types'
import type { HubShell } from './hub-shell.types'
import type { HubSpawner } from './hub.types'

/** The id the hosted engines say their project was created with. */
const CREATION_ID = 'creation-1'
const SCL: HubSpawner = { dialecteId: 'scl', dialecteVersion: '1.0.0' }

/** What a case leaves: realm locks let go, ports closed. */
const cleanups: (() => void)[] = []

afterEach(function cleanUp() {
	vi.useRealTimers()
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A realm as the hub sees it: its end of a control port, what the hub told it, its lock. */
type FakeRealm = {
	realmId: string
	port: MessagePort
	send: (message: RealmToHubMessage, transfer?: Transferable[]) => void
	/** The next message of that type the hub sends this realm (one already received counts). */
	next: <GenericType extends HubToRealmMessage['type']>(
		type: GenericType,
	) => Promise<Extract<HubToRealmMessage, { type: GenericType }>>
	received: HubToRealmMessage[]
	/** The realm's lock let go: the realm is gone for the hub. */
	die: () => void
}

/** A unique realm id: Web Locks are per origin, shared by every case of the run. */
function uniqueRealm(name: string): string {
	return `${name}-${crypto.randomUUID()}`
}

/** A realm port on `port`, listening to every message of the hub. */
function realmOn(params: { realmId: string; port: MessagePort; die?: () => void }): FakeRealm {
	const { realmId, port } = params
	const received: HubToRealmMessage[] = []
	const waiters: { type: string; resolve: (message: HubToRealmMessage) => void }[] = []
	port.onmessage = function hearHub(event: MessageEvent<HubToRealmMessage>) {
		const waiter = waiters.find(function waitsFor(candidate) {
			return candidate.type === event.data.type
		})
		if (waiter) {
			waiters.splice(waiters.indexOf(waiter), 1)
			waiter.resolve(event.data)
			return
		}
		received.push(event.data)
	}
	cleanups.push(function closePort() {
		port.close()
	})
	return {
		realmId,
		port,
		received,
		send: function sendToHub(message, transfer = []) {
			port.postMessage(message, transfer)
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
				waiters.push({ type, resolve: resolve as (message: HubToRealmMessage) => void })
			})
		},
		die: params.die ?? function cannotDie() {},
	}
}

/** A top-level realm connected to the hub: its lock held, its hello said, welcomed. */
async function joinRealm(params: {
	hub: HubShell
	name: string
	spawners?: HubSpawner[]
	topLevel?: boolean
}): Promise<FakeRealm> {
	const { hub, name, spawners = [SCL], topLevel = true } = params
	const realmId = uniqueRealm(name)
	const release = await holdLock({ name: `${REALM_LOCK_PREFIX}${realmId}` })
	cleanups.push(release)
	const channel = new MessageChannel()
	hub.connect({ port: channel.port2 })
	const realm = realmOn({ realmId, port: channel.port1, die: release })
	realm.send({ type: 'hello', protocol: HUB_PROTOCOL_VERSION, realmId, topLevel, spawners })
	await realm.next('welcome')
	return realm
}

/** A child realm bound by `parent` under `bindingId`: its hello said through the port, welcomed. */
async function bindChild(params: { parent: FakeRealm; bindingId: string }): Promise<FakeRealm> {
	const { parent, bindingId } = params
	const channel = new MessageChannel()
	parent.send({ type: 'bind-child', bindingId, port: channel.port2 }, [channel.port2])
	const realmId = uniqueRealm('child')
	const child = realmOn({ realmId, port: channel.port1 })
	child.send({
		type: 'hello',
		protocol: HUB_PROTOCOL_VERSION,
		realmId,
		topLevel: false,
		spawners: [],
	})
	await child.next('welcome')
	return child
}

/** The hub's watch of the realm's lock granted and let go: the realm dropped. */
async function untilDropped(params: { realm: FakeRealm }): Promise<void> {
	await vi.waitFor(
		async function realmDropped() {
			const { held = [], pending = [] } = await navigator.locks.query()
			const watched = [...held, ...pending].filter(function isRealmLock(lock) {
				return lock.name === `${REALM_LOCK_PREFIX}${params.realm.realmId}`
			})
			expect(watched).toEqual([])
		},
		{ timeout: 5_000 },
	)
}

/** A Web Lock held until the returned release is called. */
async function holdLock(params: { name: string }): Promise<() => void> {
	let release: () => void = function releaseNothing() {}
	await new Promise<void>(function waitForGrant(granted) {
		void navigator.locks.request(params.name, function holdUntilReleased() {
			granted()
			return new Promise<void>(function waitForRelease(done) {
				release = done
			})
		})
	})
	return release
}

/** The host told to spawn the project's engine, the engine opened, and adopting every client asked. */
async function hostEngine(params: { host: FakeRealm; project: string }): Promise<number> {
	const { host, project } = params
	const spawn = await host.next('spawn-engine')
	host.send({
		type: 'engine-opened',
		project,
		dialecteId: 'scl',
		generation: spawn.generation,
		creationId: CREATION_ID,
	})
	return spawn.generation
}

/** The host's engine adopts the next client asked: its end of the port answered. */
async function adoptNext(params: { host: FakeRealm }): Promise<MessagePort> {
	const adopt = await params.host.next('adopt-client')
	params.host.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
	return adopt.port
}

function keyOf(error: unknown): string | undefined {
	return toDialecteError(fromThrownData({ data: error as never }))?.key
}

function pause(params: { ms: number }): Promise<void> {
	return new Promise(function waitAWhile(resolve) {
		setTimeout(resolve, params.ms)
	})
}

/** The messages already posted in this page delivered (a message round trip, no timer: those may be faked). */
function flushMessages(): Promise<void> {
	const channel = new MessageChannel()
	return new Promise(function waitForRoundTrip(resolve) {
		channel.port2.onmessage = function delivered() {
			channel.port1.close()
			channel.port2.close()
			resolve()
		}
		channel.port1.postMessage(undefined)
	})
}

describe('the hub serving realms on their control ports', () => {
	it('a hello of another protocol → refused STORE_PROTOCOL_MISMATCH; the port answers nothing more', async () => {
		const hub = serveHub()
		const channel = new MessageChannel()
		hub.connect({ port: channel.port2 })
		const realm = realmOn({ realmId: 'old', port: channel.port1 })
		realm.send({ type: 'hello', protocol: -1, realmId: 'old', topLevel: true, spawners: [] })
		const refused = await realm.next('hello-refused')
		expect(keyOf(refused.error)).toBe('STORE_PROTOCOL_MISMATCH')
		const realmId = uniqueRealm('old')
		const release = await holdLock({ name: `${REALM_LOCK_PREFIX}${realmId}` })
		cleanups.push(release)
		realm.send({
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			realmId,
			topLevel: true,
			spawners: [],
		})
		await pause({ ms: 50 })
		expect(realm.received).toEqual([])
	})

	it('messages that are not the protocol’s, before the hello → ignored; the hello after is welcomed', async () => {
		const hub = serveHub()
		const channel = new MessageChannel()
		hub.connect({ port: channel.port2 })
		const realmId = uniqueRealm('shell')
		const release = await holdLock({ name: `${REALM_LOCK_PREFIX}${realmId}` })
		cleanups.push(release)
		const realm = realmOn({ realmId, port: channel.port1 })
		channel.port1.postMessage(null)
		channel.port1.postMessage('open')
		channel.port1.postMessage({ type: 5 })
		realm.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		realm.send({
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			realmId,
			topLevel: true,
			spawners: [SCL],
		})
		const welcome = await realm.next('welcome')
		expect(welcome.realmId).toBe(realmId)
		await pause({ ms: 50 })
		expect(realm.received).toEqual([])
	})

	it('a project opened → its host spawns; once opened and the client adopted, the client’s port reaches the engine’s end', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		const engineEnd = await adoptNext({ host: shell })
		const ready = await shell.next('engine-ready')
		expect(ready).toMatchObject({ project: 'p', generation: 1 })
		const heard = new Promise(function hearOnEngineEnd(resolve) {
			engineEnd.onmessage = function hear(event) {
				resolve(event.data)
			}
		})
		ready.port.postMessage('call')
		const call = await heard
		expect(call).toBe('call')
	})

	it('a second realm opens → its port comes only once the host says the engine adopted it', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		await shell.next('engine-ready')
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		const adopt = await shell.next('adopt-client')
		expect(adopt.clientId).toBe(tab.realmId)
		await pause({ ms: 50 })
		expect(tab.received).toEqual([])
		shell.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
		const ready = await tab.next('engine-ready')
		expect(ready.generation).toBe(1)
	})

	it('a realm refused another dialecte’s project of a name while its adoption on this one is under way → its port comes all the same', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		await shell.next('engine-ready')
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		const adopt = await shell.next('adopt-client')
		// no realm runs an nsd engine: refused, and only its own adoptions forgotten
		tab.send({ type: 'open', project: 'p', dialecteId: 'nsd', dialecteVersion: '1.0.0' })
		const refused = await tab.next('open-refused')
		expect(refused).toMatchObject({ project: 'p', dialecteId: 'nsd' })
		shell.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
		const ready = await tab.next('engine-ready')
		expect(ready).toMatchObject({ project: 'p', dialecteId: 'scl', creationId: CREATION_ID })
	})

	it('a realm leaves while the host adopts its client → no port for it once the engine has adopted', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		const adopt = await shell.next('adopt-client')
		tab.send({ type: 'leave', project: 'p', dialecteId: 'scl' })
		await shell.next('client-gone')
		shell.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
		await pause({ ms: 50 })
		expect(tab.received.map((message) => message.type)).toEqual(['left'])
	})

	it('engine reports from a realm that does not host the engine → ignored', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		await shell.next('engine-ready')
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		const adopt = await shell.next('adopt-client')
		tab.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
		tab.send({ type: 'engine-ended', project: 'p', dialecteId: 'scl', generation: 1 })
		await pause({ ms: 50 })
		expect(shell.received).toEqual([])
		expect(tab.received).toEqual([])
		shell.send({ type: 'client-adopted', adoptionId: adopt.adoptionId })
		const ready = await tab.next('engine-ready')
		expect(ready.generation).toBe(1)
	})

	it('an adoption the engine fails → that engine released, another one spawned for the clients', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		const adopt = await shell.next('adopt-client')
		shell.send({ type: 'client-adopt-failed', adoptionId: adopt.adoptionId })
		const release = await shell.next('release-engine')
		expect(release).toEqual({
			type: 'release-engine',
			project: 'p',
			dialecteId: 'scl',
			generation: 1,
		})
		const spawn = await shell.next('spawn-engine')
		expect(spawn.generation).toBe(2)
	})

	it('the host realm’s lock let go → its client told the engine is lost, then asked to host', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await adoptNext({ host: shell })
		await tab.next('engine-ready')
		shell.die()
		const lost = await tab.next('engine-lost')
		expect(lost).toEqual({ type: 'engine-lost', project: 'p', dialecteId: 'scl', generation: 1 })
		const spawn = await tab.next('spawn-engine')
		expect(spawn.generation).toBe(2)
	})

	it('a child realm bound by its parent opens, then is unbound → the engine told its client is gone', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		const channel = new MessageChannel()
		shell.send({ type: 'bind-child', bindingId: 'frame-1', port: channel.port2 }, [channel.port2])
		const child = realmOn({ realmId: 'child', port: channel.port1 })
		child.send({
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			realmId: uniqueRealm('child'),
			topLevel: false,
			spawners: [],
		})
		const welcome = await child.next('welcome')
		child.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await adoptNext({ host: shell })
		await child.next('engine-ready')
		shell.send({ type: 'unbind-child', bindingId: 'frame-1' })
		const gone = await shell.next('client-gone')
		expect(gone).toEqual({
			type: 'client-gone',
			project: 'p',
			dialecteId: 'scl',
			generation: 1,
			clientId: welcome.realmId,
		})
	})

	it('a parent gone before its child said hello → the child refused STORE_REALM_UNKNOWN at once, its port closed after', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const channel = new MessageChannel()
		shell.send({ type: 'bind-child', bindingId: 'frame-1', port: channel.port2 }, [channel.port2])
		const child = realmOn({ realmId: 'child', port: channel.port1 })
		await flushMessages()
		shell.die()
		// the hub's watch of the parent's lock granted and let go: the parent is dropped
		await vi.waitFor(async function parentDropped() {
			const { held = [], pending = [] } = await navigator.locks.query()
			const watched = [...held, ...pending].filter(function isParentLock(lock) {
				return lock.name === `${REALM_LOCK_PREFIX}${shell.realmId}`
			})
			expect(watched).toEqual([])
		})
		child.send({
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			realmId: uniqueRealm('child'),
			topLevel: false,
			spawners: [],
		})
		const refused = await child.next('hello-refused')
		expect(keyOf(refused.error)).toBe('STORE_REALM_UNKNOWN')
		await pause({ ms: 300 })
		// told once, before its port closed: its hello answered by nobody
		expect(child.received).toEqual([])
	})

	it('a child welcomed, its parent’s lock let go → the child told `dropped` before its port closes, nothing after', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const child = await bindChild({ parent: shell, bindingId: 'frame-1' })
		shell.die()
		const dropped = await child.next('dropped')
		expect(dropped).toEqual({ type: 'dropped' })
		await pause({ ms: 300 })
		expect(child.received).toEqual([])
	})

	it('a child welcomed, then unbound by its parent → the child told `dropped`', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const child = await bindChild({ parent: shell, bindingId: 'frame-1' })
		shell.send({ type: 'unbind-child', bindingId: 'frame-1' })
		const dropped = await child.next('dropped')
		expect(dropped).toEqual({ type: 'dropped' })
	})

	it('a child bound by a child, the top page’s lock let go → both told `dropped`', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const child = await bindChild({ parent: shell, bindingId: 'frame-1' })
		const grandchild = await bindChild({ parent: child, bindingId: 'frame-1-1' })
		shell.die()
		expect(await child.next('dropped')).toEqual({ type: 'dropped' })
		expect(await grandchild.next('dropped')).toEqual({ type: 'dropped' })
	})

	it('a top-level realm’s lock let go → nothing posted to its port', async () => {
		const hub = serveHub()
		const tab = await joinRealm({ hub, name: 'tab' })
		tab.die()
		await untilDropped({ realm: tab })
		await pause({ ms: 300 })
		expect(tab.received).toEqual([])
	})

	it('a bound port its child says it will not use, before any hello → its binding forgotten: nothing posted to it when its parent goes', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const channel = new MessageChannel()
		shell.send({ type: 'bind-child', bindingId: 'frame-1', port: channel.port2 }, [channel.port2])
		const child = realmOn({ realmId: 'child', port: channel.port1 })
		await flushMessages()
		child.send({ type: 'port-unused' })
		await flushMessages()
		shell.die()
		await untilDropped({ realm: shell })
		await pause({ ms: 300 })
		expect(child.received).toEqual([])
	})

	it('the watch of a realm’s lock failing → told on the console, no unhandled rejection', async () => {
		const failure = new Error('the lock manager failed')
		const request = navigator.locks.request.bind(navigator.locks)
		const requestSpy = vi
			.spyOn(navigator.locks, 'request')
			.mockImplementation(function failRealmWatch(name: string, ...rest: unknown[]) {
				const options = rest.length > 1 ? (rest[0] as LockOptions) : undefined
				if (name.startsWith(REALM_LOCK_PREFIX) && options?.signal) return Promise.reject(failure)
				return (request as (...args: unknown[]) => Promise<unknown>)(name, ...rest)
			} as typeof navigator.locks.request)
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(function quiet() {})
		onTestFinished(function restoreSpies() {
			requestSpy.mockRestore()
			consoleSpy.mockRestore()
		})
		const hub = serveHub()
		await joinRealm({ hub, name: 'shell' })
		await vi.waitFor(function told() {
			expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), failure)
		})
	})

	it('the last client leaves → its engine released once the idle grace has passed', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: shell, project: 'p' })
		await adoptNext({ host: shell })
		await shell.next('engine-ready')
		let released = false
		void shell.next('release-engine').then(function keepRelease() {
			released = true
		})
		shell.send({ type: 'leave', project: 'p', dialecteId: 'scl' })
		await flushMessages()
		await vi.advanceTimersByTimeAsync(ENGINE_IDLE_CLOSE_MS - 1)
		await flushMessages()
		expect(released).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		await expect
			.poll(function releaseTold() {
				return released
			})
			.toBe(true)
	})

	it('an engine that never says it opened → its clients refused PROJECT_ENGINE_UNAVAILABLE once the open budget has passed', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		shell.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await shell.next('spawn-engine')
		let refusal: Extract<HubToRealmMessage, { type: 'open-refused' }> | undefined
		void shell.next('open-refused').then(function keepRefusal(message) {
			refusal = message
		})
		await vi.advanceTimersByTimeAsync(HUB_OPEN_BUDGET_MS - 1)
		await flushMessages()
		expect(refusal).toBeUndefined()
		await vi.advanceTimersByTimeAsync(1)
		await expect
			.poll(function refusalKey() {
				return refusal && keyOf(refusal.error)
			})
			.toBe('PROJECT_ENGINE_UNAVAILABLE')
	})

	it('a destroy while another realm uses the project → refused PROJECT_OPEN_ELSEWHERE; alone → granted', async () => {
		const hub = serveHub()
		const shell = await joinRealm({ hub, name: 'shell' })
		const tab = await joinRealm({ hub, name: 'tab' })
		tab.send({ type: 'open', project: 'p', dialecteId: 'scl', dialecteVersion: '1.0.0' })
		await hostEngine({ host: tab, project: 'p' })
		await adoptNext({ host: tab })
		shell.send({ type: 'destroy', project: 'p', dialecteId: 'scl' })
		const refused = await shell.next('destroy-refused')
		expect(keyOf(refused.error)).toBe('PROJECT_OPEN_ELSEWHERE')
		tab.send({ type: 'leave', project: 'p', dialecteId: 'scl' })
		await tab.next('client-gone')
		shell.send({ type: 'destroy', project: 'p', dialecteId: 'scl' })
		const granted = await shell.next('destroy-granted')
		expect(granted.project).toBe('p')
		await tab.next('release-engine')
		shell.send({ type: 'destroyed', project: 'p', dialecteId: 'scl' })
	})
})
