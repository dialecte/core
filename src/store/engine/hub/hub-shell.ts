import { toThrownData } from '../wire/error-envelope'
import { HUB_HELLO_BUDGET_MS } from './hub-client.constants'
import { createHubRouter } from './hub-router'
import { REALM_LOCK_PREFIX, HUB_LOCK_PREFIX } from './hub.constants'

import { createDialecteError } from '@/errors'

import type { ThrownData } from '../wire/wire.types'
import type { HubToRealmMessage, RealmToHubMessage } from './hub-protocol.types'
import type {
	HelloContext,
	HubShell,
	HubShellState,
	ServeHubParams,
	ShellFeed,
} from './hub-shell.types'
import type { HubCommand, HubEvent, HubRefusal } from './hub.types'

/**
 * The hub as the browser runs it: the router's decisions carried out on ports and locks. Each realm
 * speaks on its control port; the hub watches each realm's lock (its grant: the realm is gone), keeps
 * one timer for the router's next deadline, and never relays a call: a client's port to its engine is
 * one end of a channel whose other end the host hands its engine. A client gets its port only once the
 * host says the engine adopted the other end; an adoption that fails ends that engine.
 *
 * The hub holds a Web Lock of its own for its life, named in each welcome (a realm granted it knows the hub is
 * gone): a hub served in a page holds it as long as the page lives.
 */
export function serveHub(params: ServeHubParams = {}): HubShell {
	const { helloBudgetMs = HUB_HELLO_BUDGET_MS } = params
	const router = createHubRouter()
	const state: HubShellState = {
		realms: new Map(),
		hosts: new Map(),
		adoptions: new Map(),
		nextAdoptionId: 0,
		bindings: new Map(),
		timer: undefined,
		hubLock: `${HUB_LOCK_PREFIX}${crypto.randomUUID()}`,
	}
	// asked before any realm can be welcomed, so before any realm asks for it to watch it
	holdForLife({ name: state.hubLock })

	function feed(params: ShellFeed): void {
		const output = router.handle(params.event)
		for (const command of output.commands) {
			perform({ state, command, hello: params.hello, feed })
		}
		scheduleTick({ state, wakeAt: output.wakeAt, feed })
	}

	function attachPort(params: {
		port: MessagePort
		parentRealmId?: string
		bindingId?: string
	}): void {
		const { port, parentRealmId, bindingId } = params
		let realmId: string | undefined
		// a port of its own that says nothing: let go once its realm has given up joining (a child's waits for its document)
		const silence =
			bindingId === undefined
				? setTimeout(function letSilentPortGo() {
						port.onmessage = null
						port.close()
					}, helloBudgetMs)
				: undefined
		port.onmessage = function hearRealm(event: MessageEvent<RealmToHubMessage | undefined>) {
			const message = event.data
			if (typeof message?.type !== 'string') return
			if (message.type === 'hello') {
				if (realmId !== undefined) return
				clearTimeout(silence)
				realmId = message.realmId
				feed({
					event: {
						type: 'hello',
						now: performance.now(),
						realmId: message.realmId,
						protocol: message.protocol,
						topLevel: message.topLevel,
						spawners: message.spawners,
						parentRealmId,
					},
					hello: { port, bindingId },
				})
				return
			}
			// a child letting its bound port go before any hello: that binding forgotten
			if (message.type === 'port-unused' && realmId === undefined) {
				clearTimeout(silence)
				if (bindingId !== undefined) state.bindings.delete(bindingId)
				port.close()
				return
			}
			// nothing but a hello before the hub welcomed the realm
			if (realmId === undefined || state.realms.get(realmId)?.port !== port) return
			hearWelcomedRealm({ realmId, message })
		}
	}

	function hearWelcomedRealm(params: { realmId: string; message: RealmToHubMessage }): void {
		const { realmId, message } = params
		const now = performance.now()
		switch (message.type) {
			case 'open':
				return feed({ event: { ...message, now, realmId } })
			case 'leave':
			case 'destroy':
			case 'destroyed':
				return feed({
					event: {
						type: message.type,
						now,
						realmId,
						project: message.project,
						dialecteId: message.dialecteId,
					},
				})
			case 'bind-child':
				state.bindings.set(message.bindingId, {
					port: message.port,
					parentRealmId: realmId,
					realmId: undefined,
				})
				return attachPort({
					port: message.port,
					parentRealmId: realmId,
					bindingId: message.bindingId,
				})
			case 'unbind-child':
				return unbindChild({ state, bindingId: message.bindingId, feed })
			case 'engine-opened':
				if (!hostsEngine({ state, realmId, engine: message })) return
				return feed({
					event: {
						type: 'engine-opened',
						now,
						project: message.project,
						dialecteId: message.dialecteId,
						generation: message.generation,
						creationId: message.creationId,
					},
				})
			case 'engine-ended':
				if (!hostsEngine({ state, realmId, engine: message })) return
				return feed({
					event: {
						type: 'engine-ended',
						now,
						project: message.project,
						dialecteId: message.dialecteId,
						generation: message.generation,
					},
				})
			case 'engine-open-failed':
				if (!hostsEngine({ state, realmId, engine: message })) return
				return feed({
					event: {
						type: 'engine-open-failed',
						now,
						project: message.project,
						dialecteId: message.dialecteId,
						generation: message.generation,
						failure: { key: message.key, error: message.error },
					},
				})
			case 'client-adopted':
				return deliverPort({ state, realmId, adoptionId: message.adoptionId })
			case 'client-adopt-failed':
				return failAdoption({ state, realmId, adoptionId: message.adoptionId, feed })
			default:
				return
		}
	}

	return {
		connect: function connectRealm({ port }) {
			attachPort({ port })
		},
	}
}

/** One router command carried out. */
function perform(params: {
	state: HubShellState
	command: HubCommand
	hello: HelloContext | undefined
	feed: (params: ShellFeed) => void
}): void {
	const { state, command, hello, feed } = params
	switch (command.type) {
		case 'welcome':
			return welcomeRealm({ state, realmId: command.realmId, hello })
		case 'refuse-hello':
			if (!hello) return
			post({
				port: hello.port,
				message: { type: 'hello-refused', error: refusalData(command.refusal) },
			})
			hello.port.close()
			// a child refused: its binding goes with its port
			if (hello.bindingId !== undefined) state.bindings.delete(hello.bindingId)
			return
		case 'drop-realm':
			return dropRealm({ state, realmId: command.realmId })
		case 'watch-realm-lock':
			return watchRealmLock({ state, realmId: command.realmId, feed })
		case 'spawn-engine':
			state.hosts.set(engineKey(command), command.realmId)
			return postTo({
				state,
				realmId: command.realmId,
				message: {
					type: 'spawn-engine',
					project: command.project,
					dialecteId: command.dialecteId,
					generation: command.generation,
					openBudgetMs: command.openBudgetMs,
					...(command.expectedCreationId !== undefined && {
						expectedCreationId: command.expectedCreationId,
					}),
				},
			})
		case 'connect-client':
			return askAdoption({
				state,
				project: command.project,
				dialecteId: command.dialecteId,
				generation: command.generation,
				creationId: command.creationId,
				clientRealmId: command.realmId,
				feed,
			})
		case 'engine-lost':
			forgetAdoptions({ state, realmId: command.realmId, engine: command })
			return postTo({
				state,
				realmId: command.realmId,
				message: {
					type: 'engine-lost',
					project: command.project,
					dialecteId: command.dialecteId,
					generation: command.generation,
				},
			})
		case 'refuse-open':
			forgetAdoptions({ state, realmId: command.realmId, engine: command })
			return postTo({
				state,
				realmId: command.realmId,
				message: {
					type: 'open-refused',
					project: command.project,
					dialecteId: command.dialecteId,
					error: refusalData(command.refusal),
				},
			})
		case 'client-gone': {
			// an adoption still under way delivers nothing to a client that has left
			forgetAdoptions({ state, realmId: command.realmId, engine: command })
			const hostRealmId = state.hosts.get(engineKey(command))
			if (hostRealmId === undefined) return
			return postTo({
				state,
				realmId: hostRealmId,
				message: {
					type: 'client-gone',
					project: command.project,
					dialecteId: command.dialecteId,
					generation: command.generation,
					clientId: command.realmId,
				},
			})
		}
		case 'release-engine':
			state.hosts.delete(engineKey(command))
			return postTo({
				state,
				realmId: command.hostRealmId,
				message: {
					type: 'release-engine',
					project: command.project,
					dialecteId: command.dialecteId,
					generation: command.generation,
				},
			})
		case 'left':
			return postTo({
				state,
				realmId: command.realmId,
				message: { type: 'left', project: command.project, dialecteId: command.dialecteId },
			})
		case 'destroy-granted':
			return postTo({
				state,
				realmId: command.realmId,
				message: {
					type: 'destroy-granted',
					project: command.project,
					dialecteId: command.dialecteId,
				},
			})
		case 'refuse-destroy':
			return postTo({
				state,
				realmId: command.realmId,
				message: {
					type: 'destroy-refused',
					project: command.project,
					dialecteId: command.dialecteId,
					error: refusalData(command.refusal),
				},
			})
		default:
			return command satisfies never
	}
}

function welcomeRealm(params: {
	state: HubShellState
	realmId: string
	hello: HelloContext | undefined
}): void {
	const { state, realmId, hello } = params
	if (!hello) return
	state.realms.set(realmId, { realmId, port: hello.port, watch: undefined })
	if (hello.bindingId !== undefined) {
		const binding = state.bindings.get(hello.bindingId)
		if (binding) binding.realmId = realmId
	}
	post({ port: hello.port, message: { type: 'welcome', realmId, hubLock: state.hubLock } })
}

/**
 * The realm forgotten: its lock watch withdrawn, its port closed - a child bound by another realm told
 * `dropped` first (it lives on, bound again by a new port; a top-level realm gone hears nothing) - and the
 * clients' ports it waited for closed.
 */
function dropRealm(params: { state: HubShellState; realmId: string }): void {
	const { state, realmId } = params
	const realm = state.realms.get(realmId)
	if (!realm) return
	state.realms.delete(realmId)
	realm.watch?.abort()
	if (isBoundChild({ state, realmId })) post({ port: realm.port, message: { type: 'dropped' } })
	realm.port.close()
	for (const [adoptionId, adoption] of state.adoptions) {
		if (adoption.clientRealmId !== realmId) continue
		adoption.port.close()
		state.adoptions.delete(adoptionId)
	}
	for (const [bindingId, binding] of state.bindings) {
		if (binding.realmId === realmId) state.bindings.delete(bindingId)
		// a child that never said hello: refused at once, as a hello the hub cannot place is; its port goes with its parent
		if (binding.realmId === undefined && binding.parentRealmId === realmId) {
			post({
				port: binding.port,
				message: {
					type: 'hello-refused',
					error: refusalData({
						origin: 'hub',
						key: 'STORE_REALM_UNKNOWN',
						detail: `the view that bound this one ("${realmId}") is gone`,
						meta: { realmId },
					}),
				},
			})
			binding.port.close()
			state.bindings.delete(bindingId)
		}
	}
}

/** A realm a parent bound through a port of its own, welcomed under that binding. */
function isBoundChild(params: { state: HubShellState; realmId: string }): boolean {
	for (const binding of params.state.bindings.values()) {
		if (binding.realmId === params.realmId) return true
	}
	return false
}

/** The realm's lock asked for: granted once the realm let it go (it died, or suspended). */
function watchRealmLock(params: {
	state: HubShellState
	realmId: string
	feed: (params: ShellFeed) => void
}): void {
	const { state, realmId, feed } = params
	const realm = state.realms.get(realmId)
	if (!realm) return
	const controller = new AbortController()
	realm.watch = controller
	navigator.locks
		.request(`${REALM_LOCK_PREFIX}${realmId}`, { signal: controller.signal }, function realmGone() {
			feed({ event: { type: 'realm-gone', now: performance.now(), realmId } })
		})
		.catch(function watchWithdrawn(error: unknown) {
			// the realm was dropped first: nothing to tell. Anything else is the browser's lock manager
			// failing: told, and the realm kept (taken as gone, a live realm's engines would be elected twice)
			if ((error as { name?: unknown } | undefined)?.name === 'AbortError') return
			console.error('The hub could not watch a view for its end:', error)
		})
}

/** A child realm unbound by its parent: gone, as a dead realm is; one that never said hello just closed. */
function unbindChild(params: {
	state: HubShellState
	bindingId: string
	feed: (params: ShellFeed) => void
}): void {
	const { state, bindingId, feed } = params
	const binding = state.bindings.get(bindingId)
	if (!binding) return
	if (binding.realmId === undefined) {
		state.bindings.delete(bindingId)
		binding.port.close()
		return
	}
	// kept while the child is dropped: it is told why its port closes
	feed({ event: { type: 'realm-gone', now: performance.now(), realmId: binding.realmId } })
	state.bindings.delete(bindingId)
}

/** A client's port made: one end to the engine's host to adopt, the other kept for the client until then. */
function askAdoption(params: {
	state: HubShellState
	project: string
	dialecteId: string
	generation: number
	creationId: string
	clientRealmId: string
	feed: (params: ShellFeed) => void
}): void {
	const { state, project, dialecteId, generation, creationId, clientRealmId, feed } = params
	const hostRealmId = state.hosts.get(engineKey({ project, generation }))
	const host = hostRealmId === undefined ? undefined : state.realms.get(hostRealmId)
	if (hostRealmId === undefined || !host) {
		// no realm to adopt it: that engine taken as ended, once the router's step is over
		queueMicrotask(function endHostlessEngine() {
			feed({
				event: { type: 'engine-ended', now: performance.now(), project, dialecteId, generation },
			})
		})
		return
	}
	const channel = new MessageChannel()
	state.nextAdoptionId += 1
	const adoptionId = state.nextAdoptionId
	state.adoptions.set(adoptionId, {
		hostRealmId,
		clientRealmId,
		project,
		dialecteId,
		generation,
		creationId,
		port: channel.port1,
	})
	post({
		port: host.port,
		message: {
			type: 'adopt-client',
			project,
			dialecteId,
			generation,
			adoptionId,
			clientId: clientRealmId,
			port: channel.port2,
		},
		transfer: [channel.port2],
	})
}

/**
 * The engine adopted the client: its port handed over. A client gone, left or refused meanwhile, or an
 * engine released meanwhile, gets none; an answer from another realm than the host is ignored.
 */
function deliverPort(params: { state: HubShellState; realmId: string; adoptionId: number }): void {
	const { state, realmId, adoptionId } = params
	const adoption = state.adoptions.get(adoptionId)
	if (adoption?.hostRealmId !== realmId) return
	state.adoptions.delete(adoptionId)
	const client = state.realms.get(adoption.clientRealmId)
	if (!client || state.hosts.get(engineKey(adoption)) !== realmId) {
		adoption.port.close()
		return
	}
	post({
		port: client.port,
		message: {
			type: 'engine-ready',
			project: adoption.project,
			dialecteId: adoption.dialecteId,
			generation: adoption.generation,
			creationId: adoption.creationId,
			port: adoption.port,
		},
		transfer: [adoption.port],
	})
}

/** The engine could not adopt the client: that engine is taken as ended (its clients get another one). */
function failAdoption(params: {
	state: HubShellState
	realmId: string
	adoptionId: number
	feed: (params: ShellFeed) => void
}): void {
	const { state, realmId, adoptionId, feed } = params
	const adoption = state.adoptions.get(adoptionId)
	if (adoption?.hostRealmId !== realmId) return
	state.adoptions.delete(adoptionId)
	adoption.port.close()
	feed({
		event: {
			type: 'engine-ended',
			now: performance.now(),
			project: adoption.project,
			dialecteId: adoption.dialecteId,
			generation: adoption.generation,
		},
	})
}

/** Whether the realm hosts that engine: an engine's reports count from its host only. */
function hostsEngine(params: {
	state: HubShellState
	realmId: string
	engine: { project: string; generation: number }
}): boolean {
	return params.state.hosts.get(engineKey(params.engine)) === params.realmId
}

/**
 * The ports waiting for the client's adoption on that project (its dialecte and name) dropped: its engine is
 * gone, or it is refused.
 */
function forgetAdoptions(params: {
	state: HubShellState
	realmId: string
	engine: { project: string; dialecteId: string }
}): void {
	const { state, realmId, engine } = params
	for (const [adoptionId, adoption] of state.adoptions) {
		const sameProject =
			adoption.project === engine.project && adoption.dialecteId === engine.dialecteId
		if (adoption.clientRealmId !== realmId || !sameProject) continue
		adoption.port.close()
		state.adoptions.delete(adoptionId)
	}
}

/** One timer, at the router's next deadline. */
function scheduleTick(params: {
	state: HubShellState
	wakeAt: number | undefined
	feed: (params: ShellFeed) => void
}): void {
	const { state, wakeAt, feed } = params
	clearTimeout(state.timer)
	state.timer = undefined
	if (wakeAt === undefined) return
	state.timer = setTimeout(
		function tickRouter() {
			state.timer = undefined
			const tick: HubEvent = { type: 'tick', now: performance.now() }
			feed({ event: tick })
		},
		Math.max(0, wakeAt - performance.now()),
	)
}

/** A refusal as the realm rebuilds it: the hub's own made a structured error, an engine's as it came. */
function refusalData(refusal: HubRefusal): ThrownData {
	if (refusal.origin === 'engine') return refusal.error as ThrownData
	return toThrownData({
		thrown: createDialecteError(refusal.key, { detail: refusal.detail, meta: refusal.meta }),
	})
}

/** An engine of the hub's: its generation is the hub's own counter, never used twice, whatever the project. */
function engineKey(params: { project: string; generation: number }): string {
	return `${params.project}#${params.generation}`
}

function postTo(params: {
	state: HubShellState
	realmId: string
	message: HubToRealmMessage
}): void {
	const realm = params.state.realms.get(params.realmId)
	if (realm) post({ port: realm.port, message: params.message })
}

function post(params: {
	port: MessagePort
	message: HubToRealmMessage
	transfer?: Transferable[]
}): void {
	params.port.postMessage(params.message, params.transfer ?? [])
}

/** A Web Lock held for as long as this hub lives: let go with it. */
function holdForLife(params: { name: string }): void {
	void navigator.locks.request(params.name, function holdForever() {
		return new Promise<never>(function neverSettle() {})
	})
}
