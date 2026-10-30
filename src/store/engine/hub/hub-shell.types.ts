import type { HubEvent } from './hub.types'

/** The hub as its worker serves it: every realm's control port connected to it. */
export type HubShell = {
	connect: (params: { port: MessagePort }) => void
}

/** The scope of the hub's SharedWorker, as far as the hub reads it. */
export type SharedWorkerScope = {
	onconnect: ((event: MessageEvent) => void) | null
}

/** A realm the hub welcomed: its control port, and the watch of its lock (none for a child realm). */
export type ShellRealm = {
	realmId: string
	port: MessagePort
	watch: AbortController | undefined
}

/** A client's port handed to its engine's host, kept until the host says the engine adopted it. */
export type PendingAdoption = {
	/** The realm asked to adopt: only its answer counts. */
	hostRealmId: string
	clientRealmId: string
	project: string
	generation: number
	port: MessagePort
}

/** A child realm's port bound by its parent: the child's realm id once it said hello. */
export type ChildBinding = {
	port: MessagePort
	/** The realm that bound it: gone, it takes a child that never said hello with it. */
	parentRealmId: string
	realmId: string | undefined
}

/** What the hub keeps beside the router: ports, lock watches, adoptions under way, its one timer. */
export type HubShellState = {
	realms: Map<string, ShellRealm>
	/** `<project>#<generation>` -> the realm hosting that engine. */
	hosts: Map<string, string>
	adoptions: Map<number, PendingAdoption>
	nextAdoptionId: number
	/** Binding id -> the child realm bound under it. */
	bindings: Map<string, ChildBinding>
	timer: ReturnType<typeof setTimeout> | undefined
}

/** The port a hello came on, while the router decides on it (welcomed, or refused on that port). */
export type HelloContext = {
	port: MessagePort
	bindingId: string | undefined
}

/** One event fed to the router, with the port of a hello when it is one. */
export type ShellFeed = { event: HubEvent; hello?: HelloContext }
