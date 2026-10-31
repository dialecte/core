import { throwOpenElsewhere } from '../../store-errors'
import { ENGINE_LOST_DETAILS } from '../client/client.constants'
import { createEngineClient } from '../client/engine-client'
import { refuseOtherCreation } from '../creation-refusal'
import { projectKeyOf } from '../project-key'
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

import { createDialecteError, throwDialecteError, toDialecteError } from '@/errors'

import type { EngineLostReason } from '../client/client.types'
import type {
	ConnectHubParams,
	EngineWaiter,
	HubConnection,
	HubConnectionParams,
	HubLifecycleTargets,
	HubPortOpening,
	HubRegistry,
	JoinBudget,
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
 * call tries again. The realm registers the engines it can start whose worker is of its own origin, at
 * its first join and for the connection's life: a later call naming one the connection does not run is
 * refused `STORE_HUB_SPAWNERS_FIXED` (the connection kept); naming those or fewer, or none, gets it.
 */
export function openHubConnection(
	params: ConnectHubParams = {},
): Promise<HubConnection | undefined> {
	const kept = (globalThis as HubRegistry)[HUB_REGISTRY_KEY]
	if (!kept) {
		return keptAttempt({
			attempt: function connect() {
				return openHub(params)
			},
		})
	}
	const asked = sameOriginSpawners({ spawners: params.spawners ?? [] }).map(toHubSpawner)
	// none to check: the kept attempt itself, as every copy of the library gets it
	if (asked.length === 0) return kept
	return kept.then(function refuseOthersRun(connection) {
		if (connection) refuseSpawnersNotRun({ connection, asked })
		return connection
	})
}

/** `STORE_HUB_SPAWNERS_FIXED` when `asked` names an engine the connection does not run. */
function refuseSpawnersNotRun(params: { connection: HubConnection; asked: HubSpawner[] }): void {
	const { connection, asked } = params
	const notRun = asked.filter(function runByNone(spawner) {
		return !connection.spawners.some(function runs(registered) {
			return (
				registered.dialecteId === spawner.dialecteId &&
				registered.dialecteVersion === spawner.dialecteVersion
			)
		})
	})
	if (notRun.length === 0) return
	throwDialecteError('STORE_HUB_SPAWNERS_FIXED', {
		detail: `This page's hub connection runs ${describeSpawners({ spawners: connection.spawners })}, not ${describeSpawners({ spawners: notRun })}: connectHub registers its engines once`,
		meta: { spawners: notRun },
	})
}

/** Spawners as their dialecte and version, `none` for none. */
function describeSpawners(params: { spawners: readonly HubSpawner[] }): string {
	const { spawners } = params
	if (spawners.length === 0) return 'no engine'
	return spawners
		.map(function nameOf(spawner) {
			return `${spawner.dialecteId}@${spawner.dialecteVersion}`
		})
		.join(', ')
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
	// a hub the browser refuses to make (blocked, a sandbox: a DOMException): no hub; anything else is a bug, thrown
	let first: HubPortOpening
	try {
		first = hubPort()
	} catch (thrown) {
		if (thrown instanceof DOMException) return undefined
		throw thrown
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
	/** The realm's link to each project, by its key (`projectKeyOf`: dialecte and name). */
	const entries = new Map<string, ProjectEntry>()

	/**
	 * A project its links were refused on as destroyed while the realm was away: forgotten by the realm, so a fresh
	 * link (one that never had the project) asks the hub anew; the refused links keep their entry and its refusal.
	 */
	function forgetEntry(entry: ProjectEntry): void {
		const key = projectKeyOf(entry)
		if (entries.get(key) === entry) entries.delete(key)
	}
	/** The links of this realm counted among their project's users: from their open until released. */
	const countedLinks = new WeakSet<HubProjectLink>()
	/** The destroys asked of the hub and not answered yet, by project key. */
	const destroys = new Map<string, PendingDestroy>()
	/** The leaves said and not acknowledged yet, by project key, in the order said: each released link waits on its own. */
	const leaves = new Map<string, (() => void)[]>()
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
	/** The watch of the hub's lock of the realm instance welcomed: withdrawn as the instance ends. */
	let hubWatch: AbortController | undefined
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
				return engineReady({
					entry: entries.get(projectKeyOf(message)),
					message,
					leave: leaveRefused,
					forget: forgetEntry,
				})
			case 'engine-lost':
				return engineLost({ entry: entries.get(projectKeyOf(message)) })
			case 'open-refused':
				return openRefused({
					entry: entries.get(projectKeyOf(message)),
					error: fromThrownData({ data: message.error }),
					forget: forgetEntry,
				})
			case 'destroy-granted':
				destroys.get(projectKeyOf(message))?.granted()
				return
			case 'left':
				return leaveAcknowledged({ key: projectKeyOf(message) })
			case 'destroy-refused':
				destroys.get(projectKeyOf(message))?.refused(fromThrownData({ data: message.error }))
				return
			case 'dropped':
				return stayDropped({})
			case 'spawn-engine':
				if (phase !== 'suspended') host.spawn(message)
				return
			case 'adopt-client':
				return host.adopt(message)
			case 'client-gone':
				// nothing waits on the release here: the hub forgot the client already
				void host.clientGone(message)
				return
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
		// one budget for the realm's lock and the welcome: a document that never gets its lock fails the join too
		const budget = startJoinBudget({ budgetMs: welcomeBudgetMs })
		let abandoned = false
		let hubLock: string | undefined
		const welcomed = new Promise<void>(function waitForWelcome(resolve, reject) {
			abandonJoin = function abandon() {
				abandoned = true
				resolve()
			}
			instancePort.addEventListener(
				'message',
				function hearWelcome(event: MessageEvent<HubToRealmMessage>) {
					if (event.data?.type === 'welcome') {
						hubLock = event.data.hubLock
						resolve()
					}
					if (event.data?.type === 'hello-refused')
						reject(fromThrownData({ data: event.data.error }))
				},
			)
		})
		/** The lock, then the hello and the welcome, within the join's budget. */
		async function joinWithin(): Promise<boolean> {
			if (holdsLock) {
				const release = await holdRealmLock({ realmId: instanceId, expired: budget.expired })
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
			await welcomedWithin({ welcomed, failed: instanceFailed, expired: budget.expired })
			if (abandoned) return false
			abandonJoin = releaseNothing
			// a realm with a lock of its own watches the hub's: granted, the hub is gone
			if (holdsLock && hubLock !== undefined) watchHub({ hubLock, instanceId })
			return true
		}
		try {
			return await joinWithin()
		} catch (error) {
			// suspended meanwhile: this instance is over, whatever its budget says (its lock let go once granted)
			if (abandoned) return false
			throw error
		} finally {
			budget.clear()
		}
	}

	/**
	 * The hub's lock asked for: granted once the hub is gone (its worker crashed or was ended) - this realm
	 * instance is then over, its calls refused as for a hub out of reach, and it joins the next hub after a delay.
	 */
	function watchHub(params: { hubLock: string; instanceId: string }): void {
		const { hubLock, instanceId } = params
		const watch = new AbortController()
		hubWatch = watch
		navigator.locks
			.request(hubLock, { signal: watch.signal }, function hubGone() {
				if (realmId !== instanceId || phase !== 'joined') return
				stayUnreachable({
					error: createDialecteError('STORE_CONNECTION_FAILED', {
						detail: "The origin's hub ended: this view joins the next one",
					}),
				})
			})
			.catch(ignoreWithdrawnWatch)
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
			// coming back to the project it had: the hub starts no engine that would make it again empty
			...(entry.creationId !== undefined && { expectedCreationId: entry.creationId }),
		})
	}

	/**
	 * This realm instance over: its engines ended, its clients dropped (their calls in flight refused for
	 * `reason`), its lock let go, its port closed.
	 */
	function endInstance(params: { reason: EngineLostReason }): void {
		abandonJoin()
		hubWatch?.abort()
		hubWatch = undefined
		settleLeaves()
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

	/** The hub forgot this realm instance with its projects: every leave waiting counts no more. */
	function settleLeaves(): void {
		for (const waiting of leaves.values()) for (const resolve of waiting.splice(0)) resolve()
		leaves.clear()
	}

	/** The first leave of the project waiting acknowledged: the realm counts no more there. */
	function leaveAcknowledged(params: { key: string }): void {
		const waiting = leaves.get(params.key)
		waiting?.shift()?.()
		if (waiting?.length === 0) leaves.delete(params.key)
	}

	/** A link refused for good leaves its project: the acknowledgement settles nothing more. */
	function leaveRefused(entry: ProjectEntry): void {
		void leave({ entry, key: projectKeyOf(entry) })
	}

	/**
	 * Leave the project, settled once the hub acknowledged it (or forgot this realm instance). A bound child watches no
	 * lock of the hub's, so a hub gone would never tell it: its leave settles within the welcome budget too (a late
	 * acknowledgement still settles the leave it answers).
	 */
	function leave(params: { entry: ProjectEntry; key: string }): Promise<void> {
		const { entry, key } = params
		return new Promise(function waitForLeft(resolve) {
			const waiting = leaves.get(key) ?? []
			waiting.push(resolve)
			leaves.set(key, waiting)
			send({ type: 'leave', project: entry.project, dialecteId: entry.dialecteId })
			if (!holdsLock) setTimeout(resolve, welcomeBudgetMs)
		})
	}

	/** The users of the project (its key) in this realm but `own`, while that one is counted. */
	function otherUsers(params: { key: string; own: HubProjectLink | undefined }): number {
		const users = entries.get(params.key)?.users ?? 0
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
		spawners: spawners.map(toHubSpawner),
		ended,
		close: function closeConnection() {
			if (phase === 'refused') return
			// a bound child has no lock whose end tells the hub: it leaves each project it asked for
			if (phase === 'joined') {
				for (const entry of entries.values()) {
					if (entry.asked)
						send({ type: 'leave', project: entry.project, dialecteId: entry.dialecteId })
				}
			}
			refuse({
				error: createDialecteError('STORE_CLOSED', {
					detail: "This view's connection to the hub was closed",
					meta: { realmId },
				}),
			})
		},
		openProject: function openProjectLink(projectParams) {
			const key = projectKeyOf(projectParams)
			const existing = entries.get(key)
			// another copy of the library in the realm on another version of the dialecte: refused as another realm would be
			// (a connection ended for good answers why it ended first, as for any link)
			const mismatch =
				refusal === undefined &&
				existing &&
				dialecteMismatch({ entry: existing, asked: projectParams })
			if (mismatch) return refusedLink({ error: mismatch, project: projectParams.project })
			const entry = existing ?? newEntry(projectParams)
			entries.set(key, entry)
			entry.users += 1
			let released = false
			/** The release under way or done: a second release settles with it. */
			let releasing: Promise<void> | undefined
			/** The link counted no more in the realm; the project left with its last link, once the hub said so. */
			async function releaseOnce(): Promise<void> {
				released = true
				countedLinks.delete(link)
				entry.users -= 1
				if (entry.users > 0) return
				// an entry forgotten meanwhile (refused as away) may have been replaced by a fresh one
				if (entries.get(key) === entry) entries.delete(key)
				entry.current?.client.close({ storeName: entry.project })
				entry.current = undefined
				for (const waiter of entry.waiters.splice(0)) {
					rejectWaiter({ waiter, error: releasedLinkError({ project: entry.project }) })
				}
				// counted by the hub until it handled the leave: a destroy asked after it finds the realm gone
				if (entry.asked) await leave({ entry, key })
			}
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
					releasing ??= releaseOnce()
					return releasing
				},
			}
			countedLinks.add(link)
			return link
		},
		destroyProject: async function destroyThroughHub({ project, dialecteId, destroy, own }) {
			const key = projectKeyOf({ project, dialecteId })
			const refused = cannotWait()
			if (refused !== undefined) throw refused
			// another connection of this realm on the project (the hub sees one realm): refused here; its own
			// stays until the destroy goes ahead, the realm a client the hub does not count against it
			const open = otherUsers({ key, own: own?.link })
			if (open > 0) throwOpenElsewhere({ storeName: project, connections: open })
			if (destroys.has(key)) {
				throw createDialecteError('PROJECT_OPEN_ELSEWHERE', {
					detail: `"${project}" is being destroyed from this view already`,
					meta: { project },
				})
			}
			await new Promise<void>(function waitForGrant(granted, refused) {
				destroys.set(key, { granted, refused })
				sendWhenJoined({ type: 'destroy', project, dialecteId })
			}).finally(function forgetDestroy() {
				destroys.delete(key)
			})
			try {
				// a connection of this realm made while the grant was awaited keeps the project
				const openSince = otherUsers({ key, own: own?.link })
				if (openSince > 0) throwOpenElsewhere({ storeName: project, connections: openSince })
				void own?.letGo()
				await destroy()
			} finally {
				// to the instance granted it: one suspended since is forgotten by the hub, its hold lifted
				send({ type: 'destroyed', project, dialecteId })
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
			// welcomed still: its page handed the port as its own instance ended, so the hub forgets this one (or is
			// gone) - its leaves count no more; it goes on with the old port until the hub drops it
			else if (phase === 'joined') settleLeaves()
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

/**
 * Why a link of the realm cannot join the project's link already there: another version of its dialecte (a
 * client and its engine run the same code). Another dialecte's project of the name is another project.
 */
function dialecteMismatch(params: {
	entry: ProjectEntry
	asked: HubProjectParams
}): Error | undefined {
	const { entry, asked } = params
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
		release: async function releaseRefused() {
			released = true
		},
	}
}

function newEntry(params: HubProjectParams): ProjectEntry {
	return {
		...params,
		users: 0,
		asked: false,
		current: undefined,
		waiters: [],
		refusal: undefined,
		creationId: undefined,
	}
}

/**
 * The engine's port: a client on it, handed to every call waiting - unless the engine runs another project
 * than the one the link had (destroyed while the realm was away, made again since): the link refused for good
 * `PROJECT_DESTROYED_WHILE_AWAY`, the port closed, the project left.
 */
function engineReady(params: {
	entry: ProjectEntry | undefined
	message: Extract<HubToRealmMessage, { type: 'engine-ready' }>
	forget: (entry: ProjectEntry) => void
	leave: (entry: ProjectEntry) => void
}): void {
	const { entry, message, leave } = params
	if (!entry) {
		message.port.close()
		return
	}
	dropClient({ entry, reason: 'host-gone' })
	try {
		refuseOtherCreation({
			project: entry.project,
			expectedCreationId: entry.creationId,
			creationId: message.creationId,
		})
	} catch (refusal) {
		message.port.close()
		entry.refusal = refusal
		entry.asked = false
		leave(entry)
		for (const waiter of entry.waiters.splice(0)) rejectWaiter({ waiter, error: refusal })
		params.forget(entry)
		return
	}
	entry.creationId = message.creationId
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
function openRefused(params: {
	entry: ProjectEntry | undefined
	error: unknown
	forget: (entry: ProjectEntry) => void
}): void {
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
	// destroyed while the realm was away: the links that had the project are refused, not a fresh one
	if (key === 'PROJECT_DESTROYED_WHILE_AWAY') params.forget(entry)
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
	expired: Promise<never>
}): Promise<void> {
	const { welcomed, failed, expired } = params
	const failure =
		failed?.then(function hubFailed(error): never {
			throw error
		}) ?? new Promise<never>(waitForever)
	// a failure after the welcome is not this join's: heard by nobody else, it is let go
	failure.catch(ignoreLateFailure)
	await Promise.race([welcomed, expired, failure])
}

/**
 * A join's budget, from its start: `expired` rejects `STORE_CONNECTION_FAILED` once it has passed - the realm's
 * lock and the hub's welcome both within it; `clear` stops it once the join is over.
 */
function startJoinBudget(params: { budgetMs: number }): JoinBudget {
	const { budgetMs } = params
	let timer: ReturnType<typeof setTimeout> | undefined
	const expired = new Promise<never>(function waitBudget(_resolve, reject) {
		timer = setTimeout(function joinTooLong() {
			reject(
				createDialecteError('STORE_CONNECTION_FAILED', {
					detail: `The origin's hub did not welcome this view within ${budgetMs} ms (its lock, then the welcome)`,
					meta: { budgetMs },
				}),
			)
		}, budgetMs)
	})
	// told to whoever waits on it; once the join is over nobody does
	expired.catch(ignoreLateFailure)
	return {
		expired,
		clear: function clearBudget() {
			clearTimeout(timer)
		},
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

/**
 * Hold the realm's lock until the returned release is called, or the realm dies. Not granted before the join's
 * budget `expired`, or refused (a document not fully active), the join fails `STORE_CONNECTION_FAILED`; a grant
 * that comes after is let go at once.
 */
function holdRealmLock(params: { realmId: string; expired: Promise<never> }): Promise<() => void> {
	const { realmId, expired } = params
	return new Promise(function requestLock(granted, refused) {
		let givenUp = false
		expired.catch(function lockNotGranted(error: unknown) {
			givenUp = true
			refused(error)
		})
		navigator.locks
			.request(`${REALM_LOCK_PREFIX}${realmId}`, function holdUntilReleased() {
				return new Promise<void>(function waitForRelease(release) {
					if (givenUp) release()
					else granted(release)
				})
			})
			.catch(function lockRefused(thrown: unknown) {
				refused(
					createDialecteError('STORE_CONNECTION_FAILED', {
						detail: 'This view could not ask for its lock: it cannot join the hub',
						cause: thrown instanceof Error ? thrown : undefined,
					}),
				)
			})
	})
}

/** The hub's watch withdrawn (the instance ended first): nothing to tell. */
function ignoreWithdrawnWatch(): void {}

function releaseNothing(): void {}

/** A port handed to this realm let go unused: the hub told first, so it forgets the binding, then closed. */
function letHandedPortGo(params: { port: MessagePort }): void {
	const unused: RealmToHubMessage = { type: 'port-unused' }
	params.port.postMessage(unused)
	params.port.close()
}
