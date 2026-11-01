import { ENGINE_OPEN_BUDGET_MS } from '../client/client.constants'
import { projectKeyOf } from '../project-key'
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
	HubHold,
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
		holds: new Map(),
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
		case 'spawners':
			return addSpawners({ step, added: event })
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
		case 'destroy':
			return destroyProject({ step, destroy: event })
		case 'destroyed':
			return liftHold({ step, key: projectKeyOf(event), realmId: event.realmId })
		case 'destroy-elsewhere':
			return destroyElsewhere({ step, destroy: event })
		case 'files-deleted':
			return filesDeleted({ step, deleted: event })
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

/**
 * A realm's engines added after its hello: a dialecte it runs already keeps its first version (one engine version
 * per dialecte per realm); a child realm, or one the hub does not know, adds none.
 */
function addSpawners(params: {
	step: HubStep
	added: Extract<HubEvent, { type: 'spawners' }>
}): void {
	const { step, added } = params
	const realm = step.state.realms.get(added.realmId)
	if (!realm || realm.parentRealmId !== undefined) return
	for (const spawner of added.spawners) {
		if (!realm.spawners.has(spawner.dialecteId)) {
			realm.spawners.set(spawner.dialecteId, spawner.dialecteVersion)
		}
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
			dialecteId: open.dialecteId,
			refusal: {
				origin: 'hub',
				key: 'STORE_REALM_UNKNOWN',
				detail: `the hub knows no view "${open.realmId}"`,
				meta: { realmId: open.realmId },
			},
		})
		return
	}
	const hold = step.state.holds.get(projectKeyOf(open))
	if (hold) {
		// the project is being destroyed: the open is answered once it is done, or refused once the open
		// budget has passed
		hold.opens.set(open.realmId, open)
		return
	}
	const existing = step.state.projects.get(projectKeyOf(open))
	if (existing) {
		const refusal = openRefusal({ project: existing, open })
		if (!refusal) return joinProject({ step, project: existing, open })
		if (!givesWay({ state: step.state, project: existing, open })) {
			return refuseOpen({
				step,
				realmId: open.realmId,
				project: open.project,
				dialecteId: open.dialecteId,
				refusal,
			})
		}
		releaseEngine({ step, project: existing })
		step.state.projects.delete(projectKeyOf(existing))
	}
	startProject({ step, open })
}

/**
 * Whether an engine nobody holds (in its grace, or opening for no one) gives way to a realm on
 * another version of its dialecte: only when the host that realm would get runs its version.
 */
function givesWay(params: {
	state: HubState
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): boolean {
	const { state, project, open } = params
	if (project.clients.size > 0) return false
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
	noteExpectation({ project, open })
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
		expectations: new Map(),
		engine: spawnEngine({
			step,
			project: open.project,
			dialecteId: open.dialecteId,
			host,
			openDeadline,
			expectedCreationId: open.expectedCreationId,
		}),
		openDeadline,
		idleDeadline: undefined,
		triedHosts: [],
	}
	noteExpectation({ project, open })
	step.state.projects.set(projectKeyOf(open), project)
}

/** What the opening realm expects of the project: the creation id it had, coming back to it; none, opening it anew. */
function noteExpectation(params: {
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): void {
	const { project, open } = params
	if (open.expectedCreationId === undefined) project.expectations.delete(open.realmId)
	else project.expectations.set(open.realmId, open.expectedCreationId)
}

/**
 * The creation id an engine started for the project's clients is told to expect: none when a client opens it
 * anew (the engine then makes a missing project, and a client that expected another refuses it as it gets its
 * port); when every client comes back, the first one's - clients that had another creation are refused by the
 * engine and ask again, never served a new project nobody asked for.
 */
function sharedExpectation(params: { project: HubProject }): string | undefined {
	const { project } = params
	const expected = [...project.clients.keys()].map(function expectationOf(realmId) {
		return project.expectations.get(realmId)
	})
	const anew = expected.some(function opensAnew(one) {
		return one === undefined
	})
	return anew ? undefined : expected[0]
}

/**
 * Why a realm cannot be a client of the project's engine: the engine runs another version of the
 * dialecte (a client and its engine run the same code). Another dialecte's project of the name is
 * another project.
 */
function openRefusal(params: {
	project: HubProject
	open: Extract<HubEvent, { type: 'open' }>
}): HubRefusal | undefined {
	const { project, open } = params
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
	step.state.holds.get(projectKeyOf(leave))?.opens.delete(leave.realmId)
	const project = step.state.projects.get(projectKeyOf(leave))
	if (project) removeClient({ step, project, realmId: leave.realmId })
	// told, whatever the realm left: its close waits for it, and a destroy asked after it finds it gone
	step.commands.push({
		type: 'left',
		realmId: leave.realmId,
		project: leave.project,
		dialecteId: leave.dialecteId,
	})
}

/**
 * A realm destroys the project: refused while another realm is its client (or another destroy runs);
 * else its engine released - the asking realm, if still a client, told its engine is gone and held -
 * and the realm granted it. Opens wait until the realm says it is done, or is gone.
 */
function destroyProject(params: {
	step: HubStep
	destroy: Extract<HubEvent, { type: 'destroy' }>
}): void {
	const { step, destroy } = params
	const refusal = destroyRefusal({ state: step.state, destroy })
	if (refusal) {
		refuseDestroy({ step, destroy, refusal })
		return
	}
	holdForDestroy({ step, destroy, deleterRealmId: undefined })
	step.commands.push({
		type: 'destroy-granted',
		realmId: destroy.realmId,
		project: destroy.project,
		dialecteId: destroy.dialecteId,
	})
}

/**
 * A realm that cannot store destroys the project: refused as `destroy` is, or when no realm runs an engine of the
 * dialecte; else held as `destroy` is, and the realm deleting its files asked to - the asking child's page when it runs
 * one, else the first other realm that does. Opens wait until that realm says it is done, or is gone.
 */
function destroyElsewhere(params: {
	step: HubStep
	destroy: Extract<HubEvent, { type: 'destroy-elsewhere' }>
}): void {
	const { step, destroy } = params
	const refusal = destroyRefusal({ state: step.state, destroy })
	if (refusal) {
		refuseDestroy({ step, destroy, refusal })
		return
	}
	const deleter = deleterFor({ state: step.state, destroy })
	if (deleter === undefined) {
		refuseDestroy({
			step,
			destroy,
			refusal: {
				origin: 'hub',
				key: 'STORE_UNAVAILABLE',
				detail: `no view of the origin runs an engine of "${destroy.dialecteId}" to delete "${destroy.project}"`,
				meta: { project: destroy.project, dialecteId: destroy.dialecteId },
			},
		})
		return
	}
	holdForDestroy({ step, destroy, deleterRealmId: deleter })
	step.commands.push({
		type: 'delete-files',
		realmId: deleter,
		project: destroy.project,
		dialecteId: destroy.dialecteId,
	})
}

/** The realm to delete a project's files for one that cannot store: its page when it runs an engine of the dialecte, else the first other realm that does. */
function deleterFor(params: {
	state: HubState
	destroy: Extract<HubEvent, { type: 'destroy-elsewhere' }>
}): string | undefined {
	const { state, destroy } = params
	const asker = state.realms.get(destroy.realmId)
	function runsTheDialecte(realm: HubRealm | undefined): boolean {
		return realm !== undefined && realm.spawners.has(destroy.dialecteId)
	}
	const parent =
		asker?.parentRealmId === undefined ? undefined : state.realms.get(asker.parentRealmId)
	if (runsTheDialecte(parent)) return parent!.realmId
	return [...state.realms.values()]
		.filter(function canDelete(realm) {
			return realm.realmId !== destroy.realmId && runsTheDialecte(realm)
		})
		.sort(function byConnectionOrder(first, second) {
			return first.order - second.order
		})[0]?.realmId
}

/** The realm's destroy refused, as it came. */
function refuseDestroy(params: {
	step: HubStep
	destroy: { realmId: string; project: string; dialecteId: string }
	refusal: HubRefusal
}): void {
	const { step, destroy, refusal } = params
	step.commands.push({
		type: 'refuse-destroy',
		realmId: destroy.realmId,
		project: destroy.project,
		dialecteId: destroy.dialecteId,
		refusal,
	})
}

/**
 * The project held for a destroy: its engine released - the asking realm, if still a client, told its engine is gone
 * and held - and the opens made from now on waiting until the destroy is done. A realm whose files another deletes
 * (`deleterRealmId`) is not held: its connection lets the project go once told it is deleted, and an open of it
 * elected meanwhile would make the project again.
 */
function holdForDestroy(params: {
	step: HubStep
	destroy: { realmId: string; project: string; dialecteId: string }
	deleterRealmId: string | undefined
}): void {
	const { step, destroy, deleterRealmId } = params
	const { realmId } = destroy
	const hold: HubHold = {
		project: destroy.project,
		dialecteId: destroy.dialecteId,
		realmId,
		...(deleterRealmId !== undefined && { deleterRealmId }),
		opens: new Map(),
	}
	const project = step.state.projects.get(projectKeyOf(destroy))
	if (project) {
		const version = project.clients.get(realmId)
		if (version !== undefined) {
			if (deleterRealmId === undefined) {
				hold.opens.set(realmId, {
					type: 'open',
					now: step.now,
					realmId,
					project: project.project,
					dialecteId: project.dialecteId,
					dialecteVersion: version,
				})
			}
			if (project.engine.status === 'ready') {
				step.commands.push({
					type: 'engine-lost',
					realmId,
					project: project.project,
					dialecteId: project.dialecteId,
					generation: project.engine.generation,
				})
			}
		}
		releaseEngine({ step, project })
		step.state.projects.delete(projectKeyOf(project))
	}
	step.state.holds.set(projectKeyOf(destroy), hold)
}

/**
 * The realm deleting a project's files for another is done: the asking realm, if still there, answered - its project
 * deleted, or refused with the deleting realm's error - then the hold lifted. Ignored from a realm not asked to.
 */
function filesDeleted(params: {
	step: HubStep
	deleted: Extract<HubEvent, { type: 'files-deleted' }>
}): void {
	const { step, deleted } = params
	const key = projectKeyOf(deleted)
	const hold = step.state.holds.get(key)
	if (hold?.deleterRealmId === undefined || hold.deleterRealmId !== deleted.realmId) return
	if (step.state.realms.has(hold.realmId)) {
		if (deleted.error === undefined) {
			step.commands.push({
				type: 'destroyed-elsewhere',
				realmId: hold.realmId,
				project: hold.project,
				dialecteId: hold.dialecteId,
			})
		} else {
			refuseDestroy({ step, destroy: hold, refusal: { origin: 'engine', error: deleted.error } })
		}
	}
	liftHold({ step, key, realmId: hold.realmId, held: true })
}

/** Why a realm may not destroy the project now: unknown to the hub, another destroy runs, another realm uses it. */
function destroyRefusal(params: {
	state: HubState
	destroy: Extract<HubEvent, { type: 'destroy' | 'destroy-elsewhere' }>
}): HubRefusal | undefined {
	const { state, destroy } = params
	const { realmId, project } = destroy
	const key = projectKeyOf(destroy)
	if (!state.realms.has(realmId)) {
		return {
			origin: 'hub',
			key: 'STORE_REALM_UNKNOWN',
			detail: `the hub knows no view "${realmId}"`,
			meta: { realmId },
		}
	}
	if (state.holds.has(key)) {
		return {
			origin: 'hub',
			key: 'PROJECT_OPEN_ELSEWHERE',
			detail: `"${project}" is being destroyed by another view`,
			meta: { project },
		}
	}
	const clients = [...(state.projects.get(key)?.clients.keys() ?? [])]
	const others = clients.filter(function isOtherRealm(clientId) {
		return clientId !== realmId
	})
	if (others.length === 0) return undefined
	return {
		origin: 'hub',
		key: 'PROJECT_OPEN_ELSEWHERE',
		detail: `"${project}" is open in ${others.length} other view(s)`,
		meta: { project, connections: others.length },
	}
}

/**
 * The destroy of the project (its key) done, or its realm gone: the opens made meanwhile go on, in their order. A
 * destroy whose files another realm deletes is lifted only once that one is done or gone (`held`).
 */
function liftHold(params: { step: HubStep; key: string; realmId: string; held?: boolean }): void {
	const { step, key, realmId, held = false } = params
	const hold = step.state.holds.get(key)
	if (hold?.realmId !== realmId) return
	if (hold.deleterRealmId !== undefined && !held) return
	step.state.holds.delete(key)
	for (const open of hold.opens.values()) {
		openProject({ step, open: { ...open, now: step.now } })
	}
}

/**
 * A client is gone from a project whose engine lives on: the engine is told when the client held a
 * port; with no client left nobody waits, and the engine closes once the grace has passed.
 */
function removeClient(params: { step: HubStep; project: HubProject; realmId: string }): void {
	const { step, project, realmId } = params
	if (!forgetClient({ project, realmId })) return
	if (project.engine.status === 'ready') {
		step.commands.push({
			type: 'client-gone',
			project: project.project,
			dialecteId: project.dialecteId,
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
	for (const hold of step.state.holds.values()) {
		for (const goneId of gone) hold.opens.delete(goneId)
		if (hold.deleterRealmId !== undefined && gone.includes(hold.deleterRealmId)) {
			// what it deleted is unknown: the asking realm, if still there, told so
			if (!gone.includes(hold.realmId)) {
				refuseDestroy({
					step,
					destroy: hold,
					refusal: {
						origin: 'hub',
						key: 'STORE_ENGINE_LOST',
						detail: `the view deleting "${hold.project}" is gone: its files may be partly deleted`,
						meta: { project: hold.project, reason: 'host-gone' },
					},
				})
			}
			liftHold({ step, key: projectKeyOf(hold), realmId: hold.realmId, held: true })
			continue
		}
		if (gone.includes(hold.realmId))
			liftHold({ step, key: projectKeyOf(hold), realmId: hold.realmId })
	}
	for (const project of step.state.projects.values()) {
		if (gone.includes(project.engine.hostRealmId)) {
			for (const goneId of gone) forgetClient({ project, realmId: goneId })
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
				dialecteId: project.dialecteId,
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
		step.state.projects.delete(projectKeyOf(project))
		return
	}
	project.engine = spawnEngine({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		host,
		openDeadline: openWindow({ step, project }),
		expectedCreationId: sharedExpectation({ project }),
	})
}

/** The open window has run out: the clients still waiting are refused, the project goes. */
function closeOpenWindow(params: { step: HubStep; project: HubProject }): void {
	const { step, project } = params
	refuseClients({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
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
	step.state.projects.delete(projectKeyOf(project))
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
		dialecteId,
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
		refuseOpen({ step, realmId, project, dialecteId, refusal })
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
	expectedCreationId: string | undefined
}): HubEngine {
	const { step, project, dialecteId, host, openDeadline, expectedCreationId } = params
	const engine: HubEngine = {
		hostRealmId: host.realm.realmId,
		generation: step.state.nextGeneration++,
		dialecteVersion: host.dialecteVersion,
		status: 'opening',
		creationId: undefined,
		expectedCreationId,
	}
	step.commands.push({
		type: 'spawn-engine',
		realmId: engine.hostRealmId,
		project,
		dialecteId,
		generation: engine.generation,
		openBudgetMs: Math.min(ENGINE_OPEN_BUDGET_MS, openDeadline - step.now),
		...(expectedCreationId !== undefined && { expectedCreationId }),
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
		dialecteId: opened.dialecteId,
		generation: opened.generation,
	})
	// only an engine still opening answers its open: a repeat or a late answer changes nothing
	if (project?.engine.status !== 'opening') return
	project.engine.status = 'ready'
	project.engine.creationId = opened.creationId
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
		dialecteId: failed.dialecteId,
		generation: failed.generation,
	})
	// only an engine still opening answers its open: a repeat or a late answer changes nothing
	if (project?.engine.status !== 'opening') return
	releaseEngine({ step, project })
	const openDeadline = openWindow({ step, project })
	project.triedHosts.push(project.engine.hostRealmId)
	if (failed.failure.key === ('PROJECT_DESTROYED_WHILE_AWAY' satisfies DialecteErrorKey)) {
		return refuseAwayClients({ step, project, error: failed.failure.error, openDeadline })
	}
	const retry =
		failed.failure.key === ('PROJECT_ENGINE_BUSY' satisfies DialecteErrorKey) &&
		project.clients.size > 0 &&
		openDeadline - step.now >= ENGINE_OPEN_MIN_BUDGET_MS
	const host = retry ? retryHost({ step, project }) : undefined
	if (!host) {
		refuseClients({
			step,
			project: project.project,
			dialecteId: project.dialecteId,
			clients: project.clients,
			refusal: { origin: 'engine', error: failed.failure.error },
		})
		step.state.projects.delete(projectKeyOf(project))
		return
	}
	project.engine = spawnEngine({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		host,
		openDeadline,
		expectedCreationId: sharedExpectation({ project }),
	})
}

/**
 * The engine started for clients coming back to the project refused it: destroyed meanwhile. Those clients are
 * refused as it said; a client that opened the project anew meanwhile gets an engine of its own, expecting
 * nothing (it makes the project again), if the window leaves time for one.
 */
function refuseAwayClients(params: {
	step: HubStep
	project: HubProject
	error: unknown
	openDeadline: number
}): void {
	const { step, project, error, openDeadline } = params
	const expected = project.engine.expectedCreationId
	const away = new Map(
		[...project.clients].filter(function cameBack([realmId]) {
			return project.expectations.get(realmId) === expected
		}),
	)
	for (const realmId of away.keys()) forgetClient({ project, realmId })
	refuseClients({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		clients: away,
		refusal: { origin: 'engine', error },
	})
	if (project.clients.size === 0) {
		step.state.projects.delete(projectKeyOf(project))
		return
	}
	// too little of the window left for another engine: the clients still waiting get the window's answer
	if (openDeadline - step.now < ENGINE_OPEN_MIN_BUDGET_MS) return closeOpenWindow({ step, project })
	const host = electHost({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		clients: project.clients,
	})
	if (!host) {
		step.state.projects.delete(projectKeyOf(project))
		return
	}
	project.engine = spawnEngine({
		step,
		project: project.project,
		dialecteId: project.dialecteId,
		host,
		openDeadline,
		expectedCreationId: sharedExpectation({ project }),
	})
}

/** A client the project counts no more, with what it expected of it. */
function forgetClient(params: { project: HubProject; realmId: string }): boolean {
	const { project, realmId } = params
	project.expectations.delete(realmId)
	return project.clients.delete(realmId)
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
		dialecteId: ended.dialecteId,
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
		dialecteId: project.dialecteId,
		clients: project.clients,
		refusal: {
			origin: 'hub',
			key: 'PROJECT_ENGINE_UNAVAILABLE',
			detail: `the engine of "${project.project}" ended before it opened`,
			meta: { project: project.project, dialecteId: project.dialecteId },
		},
	})
	step.state.projects.delete(projectKeyOf(project))
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
		step.state.projects.delete(projectKeyOf(project))
	}
	for (const hold of step.state.holds.values()) refuseLateHeldOpens({ step, hold })
}

/**
 * The opens a destroy has held for the whole open budget refused (the realm destroying it may never say
 * it is done): the project stays held, a later open waits again.
 */
function refuseLateHeldOpens(params: { step: HubStep; hold: HubHold }): void {
	const { step, hold } = params
	for (const open of hold.opens.values()) {
		if (open.now + HUB_OPEN_BUDGET_MS > step.now) continue
		hold.opens.delete(open.realmId)
		refuseOpen({
			step,
			realmId: open.realmId,
			project: hold.project,
			dialecteId: hold.dialecteId,
			refusal: {
				origin: 'hub',
				key: 'PROJECT_ENGINE_UNAVAILABLE',
				detail: `"${hold.project}" is being destroyed and was not done within ${HUB_OPEN_BUDGET_MS} ms`,
				meta: { project: hold.project, openBudgetMs: HUB_OPEN_BUDGET_MS },
			},
		})
	}
}

/** The project whose engine is that generation, while it is: an answer from a released engine finds none. */
function currentProject(params: {
	state: HubState
	project: string
	dialecteId: string
	generation: number
}): HubProject | undefined {
	const project = params.state.projects.get(projectKeyOf(params))
	return project?.engine.generation === params.generation ? project : undefined
}

/** Answer every waiting client with the refusal: none of them is a client any more. */
function refuseClients(params: {
	step: HubStep
	project: string
	dialecteId: string
	clients: Map<string, string>
	refusal: HubRefusal
}): void {
	const { step, project, dialecteId, clients, refusal } = params
	for (const realmId of clients.keys()) refuseOpen({ step, realmId, project, dialecteId, refusal })
	clients.clear()
}

function refuseOpen(params: {
	step: HubStep
	realmId: string
	project: string
	dialecteId: string
	refusal: HubRefusal
}): void {
	const { step, realmId, project, dialecteId, refusal } = params
	step.commands.push({ type: 'refuse-open', realmId, project, dialecteId, refusal })
}

function releaseEngine(params: { step: HubStep; project: HubProject }): void {
	const { step, project } = params
	step.commands.push({
		type: 'release-engine',
		project: project.project,
		dialecteId: project.dialecteId,
		generation: project.engine.generation,
		hostRealmId: project.engine.hostRealmId,
	})
}

function earliestDeadline(params: { state: HubState }): number | undefined {
	const deadlines = [...params.state.projects.values()].flatMap((project) =>
		[project.openDeadline, project.idleDeadline].filter((deadline) => deadline !== undefined),
	)
	for (const hold of params.state.holds.values()) {
		for (const open of hold.opens.values()) deadlines.push(open.now + HUB_OPEN_BUDGET_MS)
	}
	return deadlines.length > 0 ? Math.min(...deadlines) : undefined
}

/** A client given a port to the ready engine, with the id its project was created with (the client checks it). */
function connectClient(params: { step: HubStep; project: HubProject; realmId: string }): void {
	const { step, project, realmId } = params
	const { creationId } = project.engine
	// an engine is ready only once it said it opened, and with which file
	if (creationId === undefined) return
	// the client now has that project: an engine started for it later must open the same one
	project.expectations.set(realmId, creationId)
	step.commands.push({
		type: 'connect-client',
		creationId,
		project: project.project,
		dialecteId: project.dialecteId,
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
