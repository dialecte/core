import { ENGINE_OPEN_BUDGET_MS } from '../sqlite.constants'
import {
	ENGINE_IDLE_CLOSE_MS,
	ENGINE_OPEN_MIN_BUDGET_MS,
	HUB_OPEN_BUDGET_MS,
	HUB_PROTOCOL_VERSION,
} from './hub.constants'

import type {
	HubCandidate,
	HubEngine,
	HubEvent,
	HubOutput,
	HubProject,
	HubRealm,
	HubRefusal,
	HubRouter,
	HubState,
	HubStep,
} from './hub.types'
import type { DialecteErrorKey } from '@/errors'

/**
 * The hub's decisions as a state machine: which realm hosts each project's engine, which client
 * gets a port, who is refused and why. Time, ports and locks stay outside: every event carries the
 * hub clock, every command names realms by id and engines by project and generation, and the
 * output says when to wake the router next.
 */
export function createHubRouter(): HubRouter {
	const state: HubState = {
		realms: new Map(),
		projects: new Map(),
		nextGeneration: 1,
		nextOrder: 0,
	}
	return {
		handle: function handleHubEvent(event: HubEvent): HubOutput {
			const step: HubStep = { state, now: event.now, commands: [] }
			routeEvent({ step, event })
			return { commands: step.commands, wakeAt: earliestDeadline({ state }) }
		},
	}
}

function routeEvent(params: { step: HubStep; event: HubEvent }): void {
	const { step, event } = params
	switch (event.type) {
		case 'hello':
			return registerRealm({ step, hello: event })
		case 'open':
			return openProject({ step, open: event })
		case 'leave':
			return leaveProject({ step, leave: event })
		case 'realm-gone':
			return removeRealm({ step, realmId: event.realmId })
		case 'engine-opened':
			return engineOpened({ step, opened: event })
		case 'engine-open-failed':
			return engineOpenFailed({ step, failed: event })
		case 'engine-ended':
			return engineEnded({ step, ended: event })
		case 'tick':
			return passDeadlines({ step })
		default:
			return event satisfies never
	}
}

function registerRealm(params: {
	step: HubStep
	hello: Extract<HubEvent, { type: 'hello' }>
}): void {
	const { step, hello } = params
	if (hello.protocol !== HUB_PROTOCOL_VERSION) {
		refuseHello({
			step,
			realmId: hello.realmId,
			refusal: {
				origin: 'hub',
				key: 'STORE_PROTOCOL_MISMATCH',
				detail: `the hub speaks protocol ${HUB_PROTOCOL_VERSION}, the view ${hello.protocol}`,
				meta: { hubProtocol: HUB_PROTOCOL_VERSION, realmProtocol: hello.protocol },
			},
		})
		return
	}
	if (step.state.realms.has(hello.realmId)) {
		refuseHello({
			step,
			realmId: hello.realmId,
			refusal: {
				origin: 'hub',
				key: 'STORE_REALM_ID_TAKEN',
				detail: `a view "${hello.realmId}" is already connected`,
				meta: { realmId: hello.realmId },
			},
		})
		return
	}
	// a child bound to a realm already gone went with it: it binds again through a live parent
	if (hello.parentRealmId !== undefined && !step.state.realms.has(hello.parentRealmId)) {
		refuseHello({
			step,
			realmId: hello.realmId,
			refusal: {
				origin: 'hub',
				key: 'STORE_REALM_UNKNOWN',
				detail: `the hub knows no view "${hello.parentRealmId}", the parent of "${hello.realmId}"`,
				meta: { realmId: hello.realmId, parentRealmId: hello.parentRealmId },
			},
		})
		return
	}
	// a child realm is a client only: an engine needs a host whose death the hub sees
	const spawners = hello.parentRealmId === undefined ? hello.spawners : []
	step.state.realms.set(hello.realmId, {
		realmId: hello.realmId,
		topLevel: hello.topLevel,
		spawners: new Map(spawners.map((spawner) => [spawner.dialecteId, spawner.dialecteVersion])),
		parentRealmId: hello.parentRealmId,
		order: step.state.nextOrder++,
	})
	step.commands.push({ type: 'welcome', realmId: hello.realmId })
	// a child realm has no lock of its own: it lives as long as its parent
	if (hello.parentRealmId === undefined) {
		step.commands.push({ type: 'watch-realm-lock', realmId: hello.realmId })
	}
}

function refuseHello(params: { step: HubStep; realmId: string; refusal: HubRefusal }): void {
	const { step, realmId, refusal } = params
	step.commands.push({ type: 'refuse-hello', realmId, refusal })
}

function openProject(params: { step: HubStep; open: Extract<HubEvent, { type: 'open' }> }): void {
	const { step, open } = params
	if (!step.state.realms.has(open.realmId)) {
		refuseOpen({
			step,
			realmId: open.realmId,
			project: open.project,
			refusal: {
				origin: 'hub',
				key: 'STORE_REALM_UNKNOWN',
				detail: `the hub knows no view "${open.realmId}"`,
				meta: { realmId: open.realmId },
			},
		})
		return
	}
	const existing = step.state.projects.get(open.project)
	if (existing) {
		const refusal = openRefusal({ project: existing, open })
		if (!refusal) return joinProject({ step, project: existing, open })
		if (!givesWay({ state: step.state, project: existing, open })) {
			return refuseOpen({ step, realmId: open.realmId, project: open.project, refusal })
		}
		releaseEngine({ step, project: existing })
		step.state.projects.delete(existing.project)
	}
	startProject({ step, open })
}

/**
 * Whether an engine nobody holds (in its grace, or opening for no one) gives way to a realm on
 * another version of the same dialecte: only when the host that realm would get runs its version.
 * A project held under another dialecte never changes hands: its files are that dialecte's.
 */
function givesWay(params: {
	state: HubState
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): boolean {
	const { state, project, open } = params
	if (project.clients.size > 0 || open.dialecteId !== project.dialecteId) return false
	const clients = new Map([[open.realmId, open.dialecteVersion]])
	const [host] = hostCandidates({ state, dialecteId: open.dialecteId, clients })
	return host?.dialecteVersion === open.dialecteVersion
}

function joinProject(params: {
	step: HubStep
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): void {
	const { step, project, open } = params
	project.clients.set(open.realmId, open.dialecteVersion)
	project.idleDeadline = undefined
	// an engine still opening: the client waits in the running window, or in a new one when the
	// window went with the last client
	if (project.engine.status === 'opening') openWindow({ step, project })
	else connectClient({ step, project, realmId: open.realmId })
}

function startProject(params: { step: HubStep; open: Extract<HubEvent, { type: 'open' }> }): void {
	const { step, open } = params
	const clients = new Map([[open.realmId, open.dialecteVersion]])
	const host = electHost({ step, project: open.project, dialecteId: open.dialecteId, clients })
	if (!host) return
	const openDeadline = step.now + HUB_OPEN_BUDGET_MS
	const project: HubProject = {
		project: open.project,
		dialecteId: open.dialecteId,
		clients,
		engine: spawnEngine({
			step,
			project: open.project,
			dialecteId: open.dialecteId,
			host,
			openDeadline,
		}),
		openDeadline,
		idleDeadline: undefined,
		triedHosts: [],
	}
	step.state.projects.set(open.project, project)
}

/**
 * Why a realm cannot be a client of the project's engine: the project is held under another
 * dialecte, or the engine runs another version of it (a client and its engine run the same code).
 */
function openRefusal(params: {
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): HubRefusal | undefined {
	const { project, open } = params
	if (open.dialecteId !== project.dialecteId) {
		return {
			origin: 'hub',
			key: 'PROJECT_DIALECTE_MISMATCH',
			detail: `"${project.project}" is open as ${project.dialecteId}, the view asks for ${open.dialecteId}`,
			meta: {
				project: project.project,
				projectDialecteId: project.dialecteId,
				realmDialecteId: open.dialecteId,
			},
		}
	}
	if (open.dialecteVersion !== project.engine.dialecteVersion) {
		return versionRefusal({
			project: project.project,
			dialecteId: project.dialecteId,
			engineVersion: project.engine.dialecteVersion,
			realmVersion: open.dialecteVersion,
		})
	}
	return undefined
}

/** A client and its engine run the same code: a realm on another version of the dialecte is refused. */
function versionRefusal(params: {
	project: string
	dialecteId: string
	engineVersion: string
	realmVersion: string
}): HubRefusal {
	const { project, dialecteId, engineVersion, realmVersion } = params
	return {
		origin: 'hub',
		key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
		detail: `the engine of "${project}" runs ${dialecteId} ${engineVersion}, the view ${realmVersion}`,
		meta: { project, dialecteId, engineVersion, realmVersion },
	}
}

function leaveProject(params: {
	step: HubStep
	leave: Extract<HubEvent, { type: 'leave' }>
}): void {
	const { step, leave } = params
	const project = step.state.projects.get(leave.project)
	if (project) removeClient({ step, project, realmId: leave.realmId })
}

/**
 * A client is gone from a project whose engine lives on: the engine is told when the client held a
 * port; with no client left nobody waits, and the engine closes once the grace has passed.
 */
function removeClient(params: { step: HubStep; project: HubProject; realmId: string }): void {
	const { step, project, realmId } = params
	if (!project.clients.delete(realmId)) return
	if (project.engine.status === 'ready') {
		step.commands.push({
			type: 'client-gone',
			project: project.project,
			generation: project.engine.generation,
			realmId,
		})
	}
	if (project.clients.size > 0) return
	project.idleDeadline = step.now + ENGINE_IDLE_CLOSE_MS
	project.openDeadline = undefined
}

/** The realm gone, with every realm bound to it: their engines with them, those projects elected again. */
function removeRealm(params: { step: HubStep; realmId: string }): void {
	const { step, realmId } = params
	// already gone with its parent, or never welcomed
	if (!step.state.realms.has(realmId)) return
	const gone = withDescendants({ state: step.state, realmId })
	for (const goneId of gone) {
		step.state.realms.delete(goneId)
		step.commands.push({ type: 'drop-realm', realmId: goneId })
	}
	for (const project of step.state.projects.values()) {
		if (gone.includes(project.engine.hostRealmId)) {
			for (const goneId of gone) project.clients.delete(goneId)
			replaceEngine({ step, project })
			continue
		}
		for (const goneId of gone) removeClient({ step, project, realmId: goneId })
	}
}

/** A realm and the realms bound to it, theirs too, parents first. */
function withDescendants(params: { state: HubState; realmId: string }): string[] {
	const { state, realmId } = params
	const found = [realmId]
	for (const parentId of found) {
		for (const realm of state.realms.values()) {
			if (realm.parentRealmId === parentId) found.push(realm.realmId)
		}
	}
	return found
}

/**
 * The project's engine is gone: its clients told, another host elected for them, within the open
 * window still running or a new one.
 */
function replaceEngine(params: { step: HubStep; project: HubProject }): void {
	const { step, project } = params
	releaseEngine({ step, project })
	if (project.engine.status === 'ready') {
		for (const clientId of project.clients.keys()) {
			step.commands.push({
				type: 'engine-lost',
				realmId: clientId,
				project: project.project,
				generation: project.engine.generation,
			})
		}
	}
	// too little of the window left for an engine to open (or none, the tick not come yet): the
	// tick's answer now, no engine started for no time
	if (
		project.openDeadline !== undefined &&
		project.openDeadline - step.now < ENGINE_OPEN_MIN_BUDGET_MS
	) {
		closeOpenWindow({ step, project })
		return
	}
	const host =
		project.clients.size > 0
			? electHost({
					step,
					project: project.project,
					dialecteId: project.dialecteId,
					clients: project.clients,
				})
			: undefined
	if (!host) {
		step.state.projects.delete(project.project)
		return
	}
	project.engine = spawnEngine({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		host,
		openDeadline: openWindow({ step, project }),
	})
}

/** The open window has run out: the clients still waiting are refused, the project goes. */
function closeOpenWindow(params: { step: HubStep; project: HubProject }): void {
	const { step, project } = params
	refuseClients({
		step,
		project: project.project,
		clients: project.clients,
		refusal: {
			origin: 'hub',
			key: 'PROJECT_ENGINE_UNAVAILABLE',
			detail: `no engine for "${project.project}" opened within ${HUB_OPEN_BUDGET_MS} ms`,
			meta: {
				project: project.project,
				dialecteId: project.dialecteId,
				openBudgetMs: HUB_OPEN_BUDGET_MS,
			},
		},
	})
	step.state.projects.delete(project.project)
}

/**
 * The window an opening engine's clients wait in: the one running, else a new one from now, where
 * no host has been tried yet.
 */
function openWindow(params: { step: HubStep; project: HubProject }): number {
	const { step, project } = params
	if (project.openDeadline === undefined) {
		project.openDeadline = step.now + HUB_OPEN_BUDGET_MS
		project.triedHosts = []
	}
	return project.openDeadline
}

/**
 * The realm to host a project's engine, the clients it cannot serve refused. With no realm able to
 * host, every client is refused; with no client left, there is nothing to start.
 */
function electHost(params: {
	step: HubStep
	project: string
	dialecteId: string
	clients: Map<string, string>
}): HubCandidate | undefined {
	const { step, project, dialecteId, clients } = params
	const [host] = hostCandidates({ state: step.state, dialecteId, clients })
	if (host) return admitClients({ step, project, dialecteId, clients, host })
	refuseClients({
		step,
		project,
		clients,
		refusal: {
			origin: 'hub',
			key: 'PROJECT_ENGINE_UNAVAILABLE',
			detail: `no connected view can start an engine of "${dialecteId}"`,
			meta: { project, dialecteId },
		},
	})
	return undefined
}

/** The host, once the clients on another version of the dialecte are refused; none left, no host. */
function admitClients(params: {
	step: HubStep
	project: string
	dialecteId: string
	clients: Map<string, string>
	host: HubCandidate
}): HubCandidate | undefined {
	const { step, project, dialecteId, clients, host } = params
	for (const [realmId, realmVersion] of clients) {
		if (realmVersion === host.dialecteVersion) continue
		const refusal = versionRefusal({
			project,
			dialecteId,
			engineVersion: host.dialecteVersion,
			realmVersion,
		})
		refuseOpen({ step, realmId, project, refusal })
		clients.delete(realmId)
	}
	return clients.size > 0 ? host : undefined
}

/**
 * Ask the host to start the project's engine, under a generation never used before, its open
 * budget cut to what is left of the open window.
 */
function spawnEngine(params: {
	step: HubStep
	project: string
	dialecteId: string
	host: HubCandidate
	openDeadline: number
}): HubEngine {
	const { step, project, dialecteId, host, openDeadline } = params
	const engine: HubEngine = {
		hostRealmId: host.realm.realmId,
		generation: step.state.nextGeneration++,
		dialecteVersion: host.dialecteVersion,
		status: 'opening',
	}
	step.commands.push({
		type: 'spawn-engine',
		realmId: engine.hostRealmId,
		project,
		dialecteId,
		generation: engine.generation,
		openBudgetMs: Math.min(ENGINE_OPEN_BUDGET_MS, openDeadline - step.now),
	})
	return engine
}

function engineOpened(params: {
	step: HubStep
	opened: Extract<HubEvent, { type: 'engine-opened' }>
}): void {
	const { step, opened } = params
	const project = currentProject({
		state: step.state,
		project: opened.project,
		generation: opened.generation,
	})
	// only an engine still opening answers its open: a repeat or a late answer changes nothing
	if (project?.engine.status !== 'opening') return
	project.engine.status = 'ready'
	project.openDeadline = undefined
	for (const realmId of project.clients.keys()) connectClient({ step, project, realmId })
}

/**
 * The engine could not open. A busy one is tried again while the window leaves time for an attempt:
 * on a host not tried yet in this window, else on the last one tried; any other failure, or a busy
 * one with no time left, goes to every waiting client as the engine gave it.
 */
function engineOpenFailed(params: {
	step: HubStep
	failed: Extract<HubEvent, { type: 'engine-open-failed' }>
}): void {
	const { step, failed } = params
	const project = currentProject({
		state: step.state,
		project: failed.project,
		generation: failed.generation,
	})
	// only an engine still opening answers its open: a repeat or a late answer changes nothing
	if (project?.engine.status !== 'opening') return
	releaseEngine({ step, project })
	const openDeadline = openWindow({ step, project })
	project.triedHosts.push(project.engine.hostRealmId)
	const retry =
		failed.failure.key === ('PROJECT_ENGINE_BUSY' satisfies DialecteErrorKey) &&
		project.clients.size > 0 &&
		openDeadline - step.now >= ENGINE_OPEN_MIN_BUDGET_MS
	const host = retry ? retryHost({ step, project }) : undefined
	if (!host) {
		refuseClients({
			step,
			project: project.project,
			clients: project.clients,
			refusal: { origin: 'engine', error: failed.failure.error },
		})
		step.state.projects.delete(project.project)
		return
	}
	project.engine = spawnEngine({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		host,
		openDeadline,
	})
}

/**
 * The engine ended while its host lives: a ready one is replaced as when its host dies; one that
 * ended before it opened is not started again (it would end again), its clients are refused.
 */
function engineEnded(params: {
	step: HubStep
	ended: Extract<HubEvent, { type: 'engine-ended' }>
}): void {
	const { step, ended } = params
	const project = currentProject({
		state: step.state,
		project: ended.project,
		generation: ended.generation,
	})
	if (!project) return
	if (project.engine.status === 'ready') {
		replaceEngine({ step, project })
		return
	}
	releaseEngine({ step, project })
	refuseClients({
		step,
		project: project.project,
		clients: project.clients,
		refusal: {
			origin: 'hub',
			key: 'PROJECT_ENGINE_UNAVAILABLE',
			detail: `the engine of "${project.project}" ended before it opened`,
			meta: { project: project.project, dialecteId: project.dialecteId },
		},
	})
	step.state.projects.delete(project.project)
}

/**
 * The host for a busy retry: the best one not tried in this window that serves a waiting client,
 * else the last one tried.
 */
function retryHost(params: { step: HubStep; project: HubProject }): HubCandidate | undefined {
	const { step, project } = params
	const candidates = hostCandidates({
		state: step.state,
		dialecteId: project.dialecteId,
		clients: project.clients,
	})
	const lastTried = project.triedHosts.at(-1)
	return (
		candidates.find(
			(candidate) =>
				!project.triedHosts.includes(candidate.realm.realmId) &&
				clientsServed({ clients: project.clients, candidate }) > 0,
		) ?? candidates.find((candidate) => candidate.realm.realmId === lastTried)
	)
}

/** The deadlines that have come: clients still waiting are refused, their engine released. */
function passDeadlines(params: { step: HubStep }): void {
	const { step } = params
	for (const project of step.state.projects.values()) {
		if (project.openDeadline === undefined || project.openDeadline > step.now) continue
		releaseEngine({ step, project })
		closeOpenWindow({ step, project })
	}
	for (const project of step.state.projects.values()) {
		if (project.idleDeadline === undefined || project.idleDeadline > step.now) continue
		releaseEngine({ step, project })
		step.state.projects.delete(project.project)
	}
}

/** The project whose engine is that generation, while it is: an answer from a released engine finds none. */
function currentProject(params: {
	state: HubState
	project: string
	generation: number
}): HubProject | undefined {
	const project = params.state.projects.get(params.project)
	return project?.engine.generation === params.generation ? project : undefined
}

/** Answer every waiting client with the refusal: none of them is a client any more. */
function refuseClients(params: {
	step: HubStep
	project: string
	clients: Map<string, string>
	refusal: HubRefusal
}): void {
	const { step, project, clients, refusal } = params
	for (const realmId of clients.keys()) refuseOpen({ step, realmId, project, refusal })
	clients.clear()
}

function refuseOpen(params: {
	step: HubStep
	realmId: string
	project: string
	refusal: HubRefusal
}): void {
	const { step, realmId, project, refusal } = params
	step.commands.push({ type: 'refuse-open', realmId, project, refusal })
}

function releaseEngine(params: { step: HubStep; project: HubProject }): void {
	const { step, project } = params
	step.commands.push({
		type: 'release-engine',
		project: project.project,
		generation: project.engine.generation,
		hostRealmId: project.engine.hostRealmId,
	})
}

function earliestDeadline(params: { state: HubState }): number | undefined {
	const deadlines = [...params.state.projects.values()].flatMap((project) =>
		[project.openDeadline, project.idleDeadline].filter((deadline) => deadline !== undefined),
	)
	return deadlines.length > 0 ? Math.min(...deadlines) : undefined
}

function connectClient(params: { step: HubStep; project: HubProject; realmId: string }): void {
	const { step, project, realmId } = params
	step.commands.push({
		type: 'connect-client',
		project: project.project,
		generation: project.engine.generation,
		realmId,
	})
}

/**
 * The realms that can host a project's engine, best first: a realm with its own lock and a spawner
 * for the dialecte; top-level realms before iframes (an iframe is torn down more often), then the
 * realms whose version of the dialecte serves the most clients, then the project's own clients,
 * then connection order.
 */
function hostCandidates(params: {
	state: HubState
	dialecteId: string
	clients: Map<string, string>
}): HubCandidate[] {
	const { state, dialecteId, clients } = params
	return [...state.realms.values()]
		.flatMap((realm) => asCandidate({ realm, dialecteId }))
		.sort((left, right) => compareCandidates({ left, right, clients }))
}

/** The realm as a host of the dialecte's engine, when it has a spawner for it. */
function asCandidate(params: { realm: HubRealm; dialecteId: string }): HubCandidate[] {
	const { realm, dialecteId } = params
	const dialecteVersion = realm.spawners.get(dialecteId)
	return dialecteVersion === undefined ? [] : [{ realm, dialecteVersion }]
}

function compareCandidates(params: {
	left: HubCandidate
	right: HubCandidate
	clients: Map<string, string>
}): number {
	const { left, right, clients } = params
	return (
		Number(right.realm.topLevel) - Number(left.realm.topLevel) ||
		clientsServed({ clients, candidate: right }) - clientsServed({ clients, candidate: left }) ||
		Number(clients.has(right.realm.realmId)) - Number(clients.has(left.realm.realmId)) ||
		left.realm.order - right.realm.order
	)
}

function clientsServed(params: { clients: Map<string, string>; candidate: HubCandidate }): number {
	const { clients, candidate } = params
	return [...clients.values()].filter((version) => version === candidate.dialecteVersion).length
}
