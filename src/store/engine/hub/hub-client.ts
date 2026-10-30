import { throwOpenElsewhere } from '../../store-errors'
import { ENGINE_LOST_DETAILS } from '../client/client.constants'
import { createEngineClient } from '../client/engine-client'
import { fromThrownData, toThrownData } from '../wire/error-envelope'
import {
	HUB_REGISTRY_KEY,
	HUB_REJOIN_FIRST_DELAY_MS,
	HUB_REJOIN_MAX_DELAY_MS,
	HUB_WELCOME_BUDGET_MS,
} from './hub-client.constants'
import {
	HUB_PROTOCOL_VERSION,
	HUB_WORKER_NAME,
	LASTING_REFUSALS,
	REALM_LOCK_PREFIX,
} from './hub.constants'
import { createRealmHost } from './realm-host'

import { createDialecteError, toDialecteError } from '@/errors'

import type { EngineLostReason } from '../client/client.types'
import type {
	ConnectHubParams,
	EngineWaiter,
	HubConnection,
	HubConnectionParams,
	HubLifecycleTargets,
	HubPortOpening,
	HubRegistry,
	HubPortHandle,
	HubProjectLink,
	HubProjectParams,
	PendingDestroy,
	ProjectEntry,
	QueuedMessage,
	RealmPhase,
	SpawnerRealm,
} from './hub-client.types'
import type { HubToRealmMessage, RealmToHubMessage } from './hub-protocol.types'
import type { HubSpawner } from './hub.types'
import type { HubEngineSpawner, RealmHost } from './realm-host.types'

/**
 * Connect this realm to the origin's hub, once: a second call - from this copy of the library or
 * another one of the same protocol - gets the first connection. Answers `undefined` where the browser
 * has no SharedWorker, or the hub never welcomed the realm (its script failed to load or was blocked,
 * or it stayed silent past the welcome budget): the caller then runs the engine itself, and a later
 * call tries again. The realm registers the engines it can start whose worker is of its own origin.
 */
export function openHubConnection(
	params: ConnectHubParams = {},
): Promise<HubConnection | undefined> {
	return keptAttempt({
		attempt: function connect() {
			return openHub(params)
		},
	})
}

/**
 * Join the hub through a port another realm made with `createHubPort` (a document that cannot reach
 * the hub's script): a client only, whose liveness is its parent's. A port nobody answers (its parent
 * unbound it) fails the join `STORE_CONNECTION_FAILED` once the welcome budget has passed. The realm's
 * connection made or under way already, if any, is answered instead - `undefined` when that attempt
 * found no hub - and it takes the new port as the one it joins on once the hub drops it (at once if it
 * has): that join runs on its own, its calls waiting for the welcome; failed, the realm stays dropped
 * until the next port.
 */
export function adoptHubConnection(params: {
	port: MessagePort
}): Promise<HubConnection | undefined> {
	const kept = (globalThis as HubRegistry)[HUB_REGISTRY_KEY]
	if (kept) {
		return kept.then(
			function bindAgainOrLetGo(connection) {
				// taken by a bound child as its next port; else not used, its binding let go with it
				if (!connection?.adoptPort({ port: params.port })) letHandedPortGo({ port: params.port })
				return connection
			},
			function joinOnHandedPort() {
				// that attempt failed (and is forgotten): the next one joins on the port handed meanwhile
				return adoptHubConnection(params)
			},
		)
	}
	return keptAttempt({
		attempt: function adoptPort() {
			return startHubConnection({
				openPort: function samePort() {
					return { port: params.port }
				},
				topLevel: false,
				spawners: [],
				holdsLock: false,
				lifecycle: undefined,
				bound: true,
			})
		},
	})
}

/**
 * The realm's connection attempt, kept under the protocol's key while it runs and once it connected;
 * one that failed (no hub, refused, never welcomed) is forgotten, so a later call tries again.
 */
function keptAttempt(params: {
	attempt: () => Promise<HubConnection | undefined>
}): Promise<HubConnection | undefined> {
	const registry = globalThis as HubRegistry
	const kept = registry[HUB_REGISTRY_KEY]
	if (kept) return kept
	const attempt = params.attempt()
	registry[HUB_REGISTRY_KEY] = attempt
	function forgetFailed(): void {
		if (registry[HUB_REGISTRY_KEY] === attempt) delete registry[HUB_REGISTRY_KEY]
	}
	void attempt.then(function forgetAbsent(connection) {
		if (!connection) return forgetFailed()
		// a connection that ends for good (refused, closed) is forgotten too
		void connection.ended.then(forgetFailed)
	}, forgetFailed)
	return attempt
}

async function openHub(params: ConnectHubParams = {}): Promise<HubConnection | undefined> {
	if (typeof SharedWorker === 'undefined') return undefined
	// a hub that cannot start (blocked, or the worker throws as it is made): no hub
	let first: HubPortOpening
	try {
		first = hubPort()
	} catch {
		return undefined
	}
	let given = false
	try {
		return await startHubConnection({
			openPort: function nextHubPort() {
				if (!given) {
					given = true
					return first
				}
				return hubPort()
			},
			topLevel: globalThis.top === (globalThis as unknown as Window),
			spawners: sameOriginSpawners({ spawners: params.spawners ?? [] }),
			holdsLock: true,
			lifecycle: { page: globalThis.document, window: globalThis },
		})
	} catch (error) {
		// a hub that never welcomed the page (its script failed to load or was blocked, or it is silent): no hub
		if (toDialecteError(error)?.key === 'STORE_CONNECTION_FAILED') return undefined
		throw error
	}
}

/**
 * A new port to the origin's hub. Written as bundlers find a worker (the URL and the options inline),
 * so the hub is a worker chunk of core's build and of the consumer's.
 */
function hubPort(): HubPortOpening {
	const worker = new SharedWorker(new URL('./hub.worker.ts', import.meta.url), {
		type: 'module',
		name: HUB_WORKER_NAME,
	})
	// a script that fails to load, is blocked, or throws as it starts is told only by this event
	const failed = new Promise<unknown>(function waitForFailure(resolve) {
		worker.addEventListener(
			'error',
			function hubFailed(event: Event) {
				const message = (event as ErrorEvent).message
				resolve(
					createDialecteError('STORE_CONNECTION_FAILED', {
						detail: `The origin's hub could not start${message ? `: ${message}` : ''}`,
					}),
				)
			},
			{ once: true },
		)
	})
	return { port: worker.port, failed }
}

/**
 * The spawners this realm can run: a worker of another origin is refused by the browser. The URL
 * resolves as `new Worker` resolves it, against the document's base URL (in a srcdoc document
 * `location` resolves nothing), and is compared with this realm's origin.
 */
export function sameOriginSpawners(params: {
	spawners: HubEngineSpawner[]
	realm?: SpawnerRealm
}): HubEngineSpawner[] {
	const { spawners, realm = globalThis as unknown as SpawnerRealm } = params
	const base = realm.document?.baseURI ?? realm.location?.href
	return spawners.filter(function isSameOrigin(spawner) {
		try {
			return new URL(spawner.engineUrl, base).origin === realm.origin
		} catch {
			return false
		}
	})
}

/**
 * A realm's connection over the ports `openPort` gives: its lock held before it says hello, the hub's
 * answers routed to its project links and to the engines it hosts. What it says before it is welcomed
 * waits for the welcome. A page that freezes or enters the back/forward cache ends its engines and lets
 * its lock go (the hub elects other hosts); back, it joins as a new realm instance and asks for every
 * project again. A hub refusing its hello (another protocol) ends it: its lock let go, everything
 * waiting on it refused.
 */
export async function startHubConnection(params: HubConnectionParams): Promise<HubConnection> {
	const {
		openPort,
		topLevel,
		spawners,
		holdsLock,
		lifecycle,
		welcomeBudgetMs = HUB_WELCOME_BUDGET_MS,
		bound = false,
	} = params
	const entries = new Map<string, ProjectEntry>()
	/** The links of this realm counted among their project's users: from their open until released. */
	const countedLinks = new WeakSet<HubProjectLink>()
	const destroys = new Map<string, PendingDestroy>()
	const queued: QueuedMessage[] = []
	const lifecycleWatch = new AbortController()
	let realmId = crypto.randomUUID()
	/** The realm's way to its hub port: a child bound again opens on the port its page handed over. */
	let openPortNow = openPort
	let opening = openPortNow()
	let port = opening.port
	let releaseLock: () => void = releaseNothing
	let phase: RealmPhase = 'joining'
	let refusal: unknown
	/** Why the hub could not be reached when the page came back: the calls are refused it until it can. */
	let unreachable: unknown
	/** Why a child dropped with its page refuses its calls, until a new port binds it again. */
	let droppedError: unknown
	/** Told each time the realm is welcomed back, never on its first welcome. */
	const rejoinListeners = new Set<() => void>()
	let welcomedOnce = false
	/** The port a child's page handed it to join on next: at once when dropped, else once it is. */
	let standbyPort: MessagePort | undefined
	let rejoinTimer: ReturnType<typeof setTimeout> | undefined
	let rejoinDelayMs = HUB_REJOIN_FIRST_DELAY_MS
	let markEnded: (reason: unknown) => void = releaseNothing
	const ended = new Promise<unknown>(function waitForEnd(resolve) {
		markEnded = resolve
	})
	/** Ends the hello in progress when the realm is suspended meanwhile (its port closed, no welcome comes). */
	let abandonJoin: () => void = releaseNothing
	const host: RealmHost = createRealmHost({ spawners, report: send })

	function send(message: RealmToHubMessage, transfer: Transferable[] = []): void {
		port.postMessage(message, transfer)
	}

	/** Said now when the realm is welcomed, else once it is (the hub drops anything before the hello). */
	function sendWhenJoined(message: RealmToHubMessage, transfer: Transferable[] = []): void {
		if (phase === 'joined') return send(message, transfer)
		// a connection ended for good says nothing more
		if (phase === 'refused') return
		queued.push({ message, transfer })
	}

	function hear(event: MessageEvent<HubToRealmMessage>): void {
		const message = event.data
		switch (message?.type) {
			case 'engine-ready':
				return engineReady({ entry: entries.get(message.project), message })
			case 'engine-lost':
				return engineLost({ entry: entries.get(message.project) })
			case 'open-refused':
				return openRefused({
					entry: entries.get(message.project),
					error: fromThrownData({ data: message.error }),
				})
			case 'destroy-granted':
				destroys.get(message.project)?.granted()
				return
			case 'destroy-refused':
				destroys.get(message.project)?.refused(fromThrownData({ data: message.error }))
				return
			case 'dropped':
				return stayDropped({})
			case 'spawn-engine':
				if (phase !== 'suspended') host.spawn(message)
				return
			case 'adopt-client':
				return host.adopt(message)
			case 'client-gone':
				return host.clientGone(message)
			case 'release-engine':
				return host.release(message)
			default:
				return
		}
	}

	/**
	 * Say hello on the realm instance's port, its lock held first. Settles `true` once welcomed, `false`
	 * when the realm is suspended meanwhile: that instance is over (its lock let go once granted), even
	 * if the realm has come back since as another one. Rejects with the hub's refusal, or
	 * `STORE_CONNECTION_FAILED` when what serves the hub failed to start or the welcome does not come
	 * within the welcome budget.
	 */
	async function join(): Promise<boolean> {
		const instancePort = port
		const instanceId = realmId
		const instanceFailed = opening.failed
		let abandoned = false
		const welcomed = new Promise<void>(function waitForWelcome(resolve, reject) {
			abandonJoin = function abandon() {
				abandoned = true
				resolve()
			}
			instancePort.addEventListener(
				'message',
				function hearWelcome(event: MessageEvent<HubToRealmMessage>) {
					if (event.data?.type === 'welcome') resolve()
					if (event.data?.type === 'hello-refused')
						reject(fromThrownData({ data: event.data.error }))
				},
			)
		})
		if (holdsLock) {
			const release = await holdRealmLock({ realmId: instanceId })
			if (abandoned) {
				release()
				return false
			}
			releaseLock = release
		}
		instancePort.addEventListener('message', hear)
		instancePort.start()
		const hello: RealmToHubMessage = {
			type: 'hello',
			protocol: HUB_PROTOCOL_VERSION,
			realmId: instanceId,
			topLevel,
			spawners: spawners.map(toHubSpawner),
		}
		instancePort.postMessage(hello)
		await welcomedWithin({ welcomed, failed: instanceFailed, budgetMs: welcomeBudgetMs })
		if (abandoned) return false
		abandonJoin = releaseNothing
		return true
	}

	/** Welcomed: what was said meanwhile goes, then every link with a use asks for its engine. */
	function joined(): void {
		phase = 'joined'
		for (const { message, transfer } of queued.splice(0)) send(message, transfer)
		for (const entry of entries.values()) {
			if (entry.waiters.length > 0 || entry.users > 0) ask(entry)
		}
		// welcomed back: the page binds its children again (each listener on its own, so one failing stops none;
		// one unsubscribed meanwhile is not called)
		if (welcomedOnce) {
			for (const listener of rejoinListeners) {
				queueMicrotask(function callIfListening() {
					if (rejoinListeners.has(listener)) listener()
				})
			}
		}
		welcomedOnce = true
	}

	/**
	 * Ask the hub for the project's engine, once per link while it has not refused; only once welcomed
	 * (an ask before the hello is dropped by the hub): the realm asks for every waiting link when it is.
	 */
	function ask(entry: ProjectEntry): void {
		if (entry.asked || phase !== 'joined') return
		entry.asked = true
		send({
			type: 'open',
			project: entry.project,
			dialecteId: entry.dialecteId,
			dialecteVersion: entry.dialecteVersion,
		})
	}

	/**
	 * This realm instance over: its engines ended, its clients dropped (their calls in flight refused for
	 * `reason`), its lock let go, its port closed.
	 */
	function endInstance(params: { reason: EngineLostReason }): void {
		abandonJoin()
		host.endAll()
		for (const entry of entries.values()) {
			dropClient({ entry, reason: params.reason })
			entry.asked = false
		}
		releaseLock()
		releaseLock = releaseNothing
		port.close()
	}

	/** The destroys not granted yet refused (the hub that would grant them forgot this realm instance). */
	function refuseDestroys(params: { error: unknown }): void {
		for (const pending of destroys.values()) pending.refused(params.error)
		for (let index = queued.length - 1; index >= 0; index--) {
			if (queued[index]!.message.type === 'destroy') queued.splice(index, 1)
		}
	}

	/**
	 * Nothing said meanwhile will reach the hub (it is out of reach, or the connection ended): the destroys
	 * refused, and each child port made meanwhile refused to its child at once (bound later, its child
	 * would be long gone).
	 */
	function dropQueued(params: { error: unknown }): void {
		const { error } = params
		refuseDestroys({ error })
		for (const { message } of queued.splice(0)) {
			if (message.type !== 'bind-child') continue
			const refusal: HubToRealmMessage = {
				type: 'hello-refused',
				error: toThrownData({ thrown: error }),
			}
			message.port.postMessage(refusal)
			message.port.close()
		}
	}

	function suspend(): void {
		if (phase === 'suspended' || phase === 'refused') return
		phase = 'suspended'
		endInstance({ reason: 'host-gone' })
		refuseDestroys({
			error: createDialecteError('PROJECT_ENGINE_UNAVAILABLE', {
				detail: 'The page was suspended before the hub granted the destroy',
				meta: { realmId },
			}),
		})
	}

	/** The hub refused the realm, or the realm closed: done for good, everything waiting on it refused with `error`. */
	function refuse(params: { error: unknown }): void {
		const { error } = params
		phase = 'refused'
		refusal = error
		clearTimeout(rejoinTimer)
		markEnded(error)
		lifecycleWatch.abort()
		endInstance({ reason: 'host-gone' })
		if (standbyPort) letHandedPortGo({ port: standbyPort })
		standbyPort = undefined
		dropQueued({ error })
		for (const entry of entries.values()) {
			entry.refusal = error
			for (const waiter of entry.waiters.splice(0)) rejectWaiter({ waiter, error })
		}
	}

	/**
	 * The hub did not welcome the page back (it failed to start, or stayed silent): the page stays suspended,
	 * the calls waiting and those made meanwhile refused `error`, and it tries again after a growing delay.
	 */
	function stayUnreachable(params: { error: unknown }): void {
		const { error } = params
		phase = 'suspended'
		unreachable = error
		endInstance({ reason: 'host-gone' })
		dropQueued({ error })
		for (const entry of entries.values()) {
			for (const waiter of entry.waiters.splice(0)) rejectWaiter({ waiter, error })
		}
		rejoinTimer = setTimeout(rejoin, rejoinDelayMs)
		rejoinDelayMs = Math.min(rejoinDelayMs * 2, HUB_REJOIN_MAX_DELAY_MS)
	}

	/**
	 * The hub dropped this bound child with the page that bound it (that page gone, frozen, or unbinding
	 * it), or its join on a new port failed (`cause`): its calls in flight, those waiting and what was said
	 * meanwhile refused `STORE_ENGINE_LOST` (`realm-dropped`), and every later one until it joins again - on
	 * the next port its page hands it, at once if it has one already.
	 */
	function stayDropped(params: { cause?: unknown }): void {
		const { cause } = params
		const error = createDialecteError('STORE_ENGINE_LOST', {
			detail: ENGINE_LOST_DETAILS['realm-dropped'],
			meta: { reason: 'realm-dropped' },
			// a join on a new port that failed: why, kept for whoever looks
			...(cause instanceof Error && { cause }),
		})
		droppedError = error
		phase = 'dropped'
		endInstance({ reason: 'realm-dropped' })
		dropQueued({ error })
		for (const entry of entries.values()) {
			for (const waiter of entry.waiters.splice(0)) rejectWaiter({ waiter, error })
		}
		joinOnStandby()
	}

	/**
	 * A bound child joining on a handed port that a newer one supersedes: that join is left (its port closed;
	 * the hub ends that instance with its parent), the newer port joined at once. What waits keeps waiting.
	 */
	function joinNewerPort(): void {
		abandonJoin()
		phase = 'dropped'
		endInstance({ reason: 'realm-dropped' })
		joinOnStandby()
	}

	/** A dropped child joins again, as a new realm instance, on the port its page handed it - if any. */
	function joinOnStandby(): void {
		const next = standbyPort
		if (!next) return
		standbyPort = undefined
		openPortNow = function handedPort() {
			return { port: next }
		}
		void resume()
	}

	function rejoin(): void {
		rejoinTimer = undefined
		void resume()
	}

	/** A new realm instance says hello: the page back, or a dropped child on the port it was handed. */
	async function resume(): Promise<void> {
		if (phase !== 'suspended' && phase !== 'dropped') return
		clearTimeout(rejoinTimer)
		rejoinTimer = undefined
		phase = 'joining'
		realmId = crypto.randomUUID()
		try {
			opening = openHubPort({ openPort: openPortNow })
			port = opening.port
			// false: suspended again while saying hello
			if (!(await join())) return
			unreachable = undefined
			rejoinDelayMs = HUB_REJOIN_FIRST_DELAY_MS
			joined()
		} catch (error) {
			// closed meanwhile, or suspended again: this attempt is over
			if (phase !== 'joining') return
			// a bound child waits for the next port its page hands it; a realm of its own tries again, or ends refused
			if (bound) stayDropped({ cause: error })
			else if (toDialecteError(error)?.key === 'STORE_CONNECTION_FAILED') stayUnreachable({ error })
			else refuse({ error })
		}
	}

	/** The users of the project in this realm but `own`, while that one is counted. */
	function otherUsers(params: { project: string; own: HubProjectLink | undefined }): number {
		const users = entries.get(params.project)?.users ?? 0
		return users - (params.own !== undefined && countedLinks.has(params.own) ? 1 : 0)
	}

	/** Why a call cannot wait for the hub now: refused for good, or the hub out of reach while suspended. */
	function cannotWait(): unknown {
		if (refusal !== undefined) return refusal
		if (phase === 'dropped') return droppedError
		if (phase === 'suspended') return unreachable
		return undefined
	}

	if (lifecycle) {
		watchLifecycle({
			targets: lifecycle,
			signal: lifecycleWatch.signal,
			suspend,
			resume,
			end: suspend,
		})
	}
	try {
		if (await join()) joined()
	} catch (error) {
		refuse({ error })
		throw error
	}

	return {
		realmId: function currentRealmId() {
			return realmId
		},
		ended,
		close: function closeConnection() {
			if (phase === 'refused') return
			refuse({
				error: createDialecteError('STORE_CLOSED', {
					detail: "This view's connection to the hub was closed",
					meta: { realmId },
				}),
			})
		},
		openProject: function openProjectLink(projectParams) {
			const existing = entries.get(projectParams.project)
			// another copy of the library in the realm on another dialecte: refused as another realm would be
			// (a connection ended for good answers why it ended first, as for any link)
			const mismatch =
				refusal === undefined &&
				existing &&
				dialecteMismatch({ entry: existing, asked: projectParams })
			if (mismatch) return refusedLink({ error: mismatch, project: projectParams.project })
			const entry = existing ?? newEntry(projectParams)
			entries.set(entry.project, entry)
			entry.users += 1
			let released = false
			const link: HubProjectLink = {
				engine: function currentEngine() {
					// a released link reaches no engine, and asks the hub for none
					if (released) return Promise.reject(releasedLinkError({ project: entry.project }))
					const refused = cannotWait()
					if (refused !== undefined) return Promise.reject(refused)
					if (entry.refusal !== undefined) return Promise.reject(entry.refusal)
					if (entry.current) return Promise.resolve(entry.current.client)
					return new Promise(function waitForEngine(resolve, reject) {
						entry.waiters.push({ resolve, reject })
						ask(entry)
					})
				},
				release: function releaseLink() {
					if (released) return
					released = true
					countedLinks.delete(link)
					entry.users -= 1
					if (entry.users > 0) return
					entries.delete(entry.project)
					entry.current?.client.close({ storeName: entry.project })
					entry.current = undefined
					for (const waiter of entry.waiters.splice(0)) {
						rejectWaiter({ waiter, error: releasedLinkError({ project: entry.project }) })
					}
					if (entry.asked) send({ type: 'leave', project: entry.project })
				},
			}
			countedLinks.add(link)
			return link
		},
		destroyProject: async function destroyThroughHub({ project, destroy, own }) {
			const refused = cannotWait()
			if (refused !== undefined) throw refused
			// another connection of this realm on the project (the hub sees one realm): refused here; its own
			// stays until the destroy goes ahead, the realm a client the hub does not count against it
			const open = otherUsers({ project, own: own?.link })
			if (open > 0) throwOpenElsewhere({ storeName: project, connections: open })
			if (destroys.has(project)) {
				throw createDialecteError('PROJECT_OPEN_ELSEWHERE', {
					detail: `"${project}" is being destroyed from this view already`,
					meta: { project },
				})
			}
			await new Promise<void>(function waitForGrant(granted, refused) {
				destroys.set(project, { granted, refused })
				sendWhenJoined({ type: 'destroy', project })
			}).finally(function forgetDestroy() {
				destroys.delete(project)
			})
			try {
				// a connection of this realm made while the grant was awaited keeps the project
				const openSince = otherUsers({ project, own: own?.link })
				if (openSince > 0) throwOpenElsewhere({ storeName: project, connections: openSince })
				own?.letGo()
				await destroy()
			} finally {
				// to the instance granted it: one suspended since is forgotten by the hub, its hold lifted
				send({ type: 'destroyed', project })
			}
		},
		onRejoined: function listenForRejoin(listener) {
			rejoinListeners.add(listener)
			return function stopListening() {
				rejoinListeners.delete(listener)
			}
		},
		adoptPort: function adoptNewPort({ port: newPort }) {
			// a realm of its own joins on its own ports; a connection ended for good joins no more
			if (!bound || phase === 'refused') return false
			// the page may be welcomed back, and hand it, before the hub has dropped this child
			if (standbyPort) letHandedPortGo({ port: standbyPort })
			standbyPort = newPort
			if (phase === 'dropped') joinOnStandby()
			// joining on an older handed port (its page frozen again meanwhile, say): that join left for this one
			else if (phase === 'joining') joinNewerPort()
			return true
		},
		createHubPort: function createChildPort(): HubPortHandle {
			const refused = cannotWait()
			if (refused !== undefined) throw refused
			const channel = new MessageChannel()
			const bindingId = crypto.randomUUID()
			sendWhenJoined({ type: 'bind-child', bindingId, port: channel.port2 }, [channel.port2])
			return {
				port: channel.port1,
				unbind: function unbindChild() {
					sendWhenJoined({ type: 'unbind-child', bindingId })
				},
			}
		},
	}
}

/** Why a link of the realm cannot join the project's link already there: another dialecte, or another version. */
function dialecteMismatch(params: {
	entry: ProjectEntry
	asked: HubProjectParams
}): Error | undefined {
	const { entry, asked } = params
	if (asked.dialecteId !== entry.dialecteId) {
		return createDialecteError('PROJECT_DIALECTE_MISMATCH', {
			detail: `"${entry.project}" is open in this view as ${entry.dialecteId}, asked as ${asked.dialecteId}`,
			meta: {
				project: entry.project,
				projectDialecteId: entry.dialecteId,
				realmDialecteId: asked.dialecteId,
			},
		})
	}
	if (asked.dialecteVersion !== entry.dialecteVersion) {
		return createDialecteError('PROJECT_DIALECTE_VERSION_MISMATCH', {
			detail: `"${entry.project}" is open in this view with ${entry.dialecteId} ${entry.dialecteVersion}, asked with ${asked.dialecteVersion}`,
			meta: {
				project: entry.project,
				dialecteId: entry.dialecteId,
				engineVersion: entry.dialecteVersion,
				realmVersion: asked.dialecteVersion,
			},
		})
	}
	return undefined
}

/** A link refused for good: every call for its engine answers `error`, `STORE_CLOSED` once released; nothing to let go. */
function refusedLink(params: { error: Error; project: string }): HubProjectLink {
	const { error, project } = params
	let released = false
	return {
		engine: function refusedEngine() {
			// released, it reaches no engine: closed, as any released link
			return Promise.reject(released ? releasedLinkError({ project }) : error)
		},
		release: function releaseRefused() {
			released = true
		},
	}
}

function newEntry(params: HubProjectParams): ProjectEntry {
	return { ...params, users: 0, asked: false, current: undefined, waiters: [], refusal: undefined }
}

/** The engine's port: a client on it, handed to every call waiting. */
function engineReady(params: {
	entry: ProjectEntry | undefined
	message: Extract<HubToRealmMessage, { type: 'engine-ready' }>
}): void {
	const { entry, message } = params
	if (!entry) {
		message.port.close()
		return
	}
	dropClient({ entry, reason: 'host-gone' })
	const client = createEngineClient({
		port: message.port,
		heartbeatTimeoutMs: entry.heartbeatTimeoutMs,
	})
	entry.current = { generation: message.generation, client }
	for (const waiter of entry.waiters.splice(0)) waiter.resolve(client)
}

/** The engine's host is gone: the calls in flight refused `host-gone`, the next ones wait for the hub. */
function engineLost(params: { entry: ProjectEntry | undefined }): void {
	if (params.entry) dropClient({ entry: params.entry, reason: 'host-gone' })
}

/** The hub refused the project: the calls waiting refused; a lasting refusal kept for the link. */
function openRefused(params: { entry: ProjectEntry | undefined; error: unknown }): void {
	const { entry, error } = params
	if (!entry) return
	entry.asked = false
	const key = toDialecteError(error)?.key
	if (
		LASTING_REFUSALS.some(function isKey(lasting) {
			return lasting === key
		})
	)
		entry.refusal = error
	for (const waiter of entry.waiters.splice(0)) rejectWaiter({ waiter, error })
}

function rejectWaiter(params: { waiter: EngineWaiter; error: unknown }): void {
	params.waiter.reject(params.error)
}

/** The engine client of the link let go: its calls in flight refused for `reason`, its port closed. */
function dropClient(params: { entry: ProjectEntry; reason: EngineLostReason }): void {
	const { entry, reason } = params
	const current = entry.current
	entry.current = undefined
	if (!current) return
	current.client.lose({ reason })
	current.client.close({ storeName: entry.project })
}

/** What the hub knows of a spawner: its dialecte and the version it runs. */
function toHubSpawner(spawner: HubEngineSpawner): HubSpawner {
	return { dialecteId: spawner.dialecteId, dialecteVersion: spawner.dialecteVersion }
}

/**
 * The page's lifecycle: a freeze or the back/forward cache suspends the realm, the page coming back
 * resumes it; the page going away ends its engines (its lock goes with it). Heard until `signal` aborts.
 */
function watchLifecycle(params: {
	targets: HubLifecycleTargets
	signal: AbortSignal
	suspend: () => void
	resume: () => Promise<void>
	end: () => void
}): void {
	const { targets, signal, suspend, resume, end } = params
	targets.page.addEventListener('freeze', suspend, { signal })
	targets.page.addEventListener(
		'resume',
		function resumeRealm() {
			void resume()
		},
		{ signal },
	)
	targets.window.addEventListener(
		'pagehide',
		function pageHidden(event: Event) {
			if ((event as PageTransitionEvent).persisted) suspend()
			else end()
		},
		{ signal },
	)
	targets.window.addEventListener(
		'pageshow',
		function pageShown(event: Event) {
			if ((event as PageTransitionEvent).persisted) void resume()
		},
		{ signal },
	)
}

/**
 * A new port to the hub; what the browser throws as it makes what serves it (a SharedWorker blocked with
 * the site's data) fails as a hub that could not start: `STORE_CONNECTION_FAILED`. Anything else thrown
 * is a fault of the caller's `openPort`, let through.
 */
function openHubPort(params: { openPort: () => HubPortOpening }): HubPortOpening {
	try {
		return params.openPort()
	} catch (thrown) {
		// what the browser refuses as it makes the worker; anything else is a bug, let through
		if (!(thrown instanceof DOMException)) throw thrown
		throw createDialecteError('STORE_CONNECTION_FAILED', {
			detail: `The origin's hub could not start: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
		})
	}
}

/**
 * The welcome, or a failure: what serves the hub failed to start, or `budgetMs` passed with no answer.
 */
async function welcomedWithin(params: {
	welcomed: Promise<void>
	failed: Promise<unknown> | undefined
	budgetMs: number
}): Promise<void> {
	const { welcomed, failed, budgetMs } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const silent = new Promise<never>(function waitBudget(_resolve, reject) {
		timer = setTimeout(function hubSilent() {
			reject(
				createDialecteError('STORE_CONNECTION_FAILED', {
					detail: `The origin's hub did not welcome this view within ${budgetMs} ms`,
					meta: { budgetMs },
				}),
			)
		}, budgetMs)
	})
	const failure =
		failed?.then(function hubFailed(error): never {
			throw error
		}) ?? new Promise<never>(waitForever)
	// a failure after the welcome is not this join's: heard by nobody else, it is let go
	failure.catch(ignoreLateFailure)
	try {
		await Promise.race([welcomed, silent, failure])
	} finally {
		clearTimeout(timer)
	}
}

function waitForever(): void {}

function ignoreLateFailure(): void {}

/** What a call for a link's engine gets once the link is released (waiting then, or made after). */
function releasedLinkError(params: { project: string }): Error {
	return createDialecteError('STORE_CLOSED', {
		detail: `The link to project "${params.project}" was released: it reaches no engine`,
		meta: { storeName: params.project },
	})
}

/** Hold the realm's lock until the returned release is called, or the realm dies. */
function holdRealmLock(params: { realmId: string }): Promise<() => void> {
	return new Promise(function requestLock(granted) {
		void navigator.locks.request(
			`${REALM_LOCK_PREFIX}${params.realmId}`,
			function holdUntilReleased() {
				return new Promise<void>(function waitForRelease(release) {
					granted(release)
				})
			},
		)
	})
}

function releaseNothing(): void {}

/** A port handed to this realm let go unused: the hub told first, so it forgets the binding, then closed. */
function letHandedPortGo(params: { port: MessagePort }): void {
	const unused: RealmToHubMessage = { type: 'port-unused' }
	params.port.postMessage(unused)
	params.port.close()
}
