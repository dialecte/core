import type { EngineClient } from '../client/client.types'
import type { RealmToHubMessage } from './hub-protocol.types'
import type { HubEngineSpawner } from './realm-host.types'

export type ConnectHubParams = {
	/** The engines this realm can start for the hub (a spawner whose worker is of another origin is left out). */
	spawners?: HubEngineSpawner[]
}

/** The realm's global object as the hub connection is kept on it, under the protocol's key. */
export type HubRegistry = Partial<Record<symbol, Promise<HubConnection | undefined>>>

/**
 * What a page holds of its connection to the hub: its realm id, and ports for the documents that cannot
 * reach the hub themselves. A child bound to a page that freezes is dropped by the hub with the page and
 * is not told yet: its calls waiting hang, its calls in flight end at the engine's heartbeat timeout, and
 * a second `adoptHubPort` in that child answers its first, dead connection.
 */
export type HubRealm = Pick<HubConnection, 'realmId' | 'createHubPort'>

/** This realm's connection to the origin's hub, shared by every copy of the library in the realm. */
export type HubConnection = {
	/** This realm instance's id (a new one after the page came back from a freeze or the cache). */
	realmId: () => string
	/** The realm's link to a project's engine: one per project, shared by the realm's connections to it. */
	openProject: (params: HubProjectParams) => HubProjectLink
	/**
	 * Destroy a project once the hub grants it (no other view uses it): `destroy` deletes the files. `own`,
	 * the destroying connection's link, does not count, and is let go once the destroy goes ahead.
	 */
	destroyProject: (params: {
		project: string
		destroy: () => Promise<void>
		own?: OwnHubLink
	}) => Promise<void>
	/** A port for a child realm that cannot reach the hub: it joins through it with `adoptHubPort`. */
	createHubPort: () => HubPortHandle
	/**
	 * Ends the connection for good: its engines ended, its lock let go, everything waiting on it and every
	 * later call refused `STORE_CLOSED`; the realm's registry forgets it.
	 */
	close: () => void
	/** Settles once the connection ended for good, with why. */
	ended: Promise<unknown>
}

export type HubProjectParams = {
	project: string
	dialecteId: string
	dialecteVersion: string
	/** How long a call waits on a silent engine (the default when absent). */
	heartbeatTimeoutMs?: number
}

/** One connection's use of the realm's link to a project. */
export type HubProjectLink = {
	/** The project's engine client now: waits for the hub's answer, rejects with its refusal. */
	engine: () => Promise<EngineClient>
	/** This connection done with the project; the realm leaves it with its last connection. */
	release: () => void
}

/** The destroying connection's own link, and how to let it go (its store forgetting it). */
export type OwnHubLink = { link: HubProjectLink; letGo: () => void }

/** A port bound to this realm for a child realm, and how to say the child is gone. */
export type HubPortHandle = {
	port: MessagePort
	/** The child is gone (its iframe removed): the hub ends what it started. */
	unbind: () => void
}

/** A call waiting for the project's engine. */
export type EngineWaiter = {
	resolve: (client: EngineClient) => void
	reject: (thrown: unknown) => void
}

/** The realm's link to one project: the connections using it, the engine client now, the calls waiting. */
export type ProjectEntry = HubProjectParams & {
	users: number
	/** The hub was asked for the project and has not refused it since. */
	asked: boolean
	current: { generation: number; client: EngineClient } | undefined
	waiters: EngineWaiter[]
	/** A refusal that holds for the rest of the link. */
	refusal: unknown
}

/**
 * Where the realm instance stands with the hub: saying hello (its lock, then the welcome), welcomed (it
 * may ask for projects and host engines), suspended (frozen, or in the back/forward cache), or refused
 * by the hub (another protocol): done for good.
 */
export type RealmPhase = 'joining' | 'joined' | 'suspended' | 'refused'

/** A message for the hub kept until the realm instance is welcomed (one sent before is dropped). */
export type QueuedMessage = { message: RealmToHubMessage; transfer: Transferable[] }

/** Where a realm hears its page's lifecycle: `freeze` / `resume` on the document, `pagehide` / `pageshow` on the window. */
export type HubLifecycleTargets = { page: EventTarget; window: EventTarget }

/** A destroy asked of the hub, waiting for its grant. */
export type PendingDestroy = {
	granted: () => void
	refused: (thrown: unknown) => void
}

/** A port to the hub, and what settles if what serves it failed to start (a SharedWorker's `error`). */
export type HubPortOpening = { port: MessagePort; failed?: Promise<unknown> }

/** The realm whose spawners are checked: where its scripts resolve from, and its origin. */
export type SpawnerRealm = {
	document?: { baseURI: string }
	location?: { href: string }
	origin: string
}

/** How a realm's connection reaches the hub: a port, a new one for each realm instance. */
export type HubConnectionParams = {
	openPort: () => HubPortOpening
	/** How long the realm waits for the hub's welcome (the default when absent). */
	welcomeBudgetMs?: number
	topLevel: boolean
	spawners: HubEngineSpawner[]
	/** Whether the realm holds a lock of its own (a child realm's liveness is its parent's). */
	holdsLock: boolean
	/** The page's lifecycle to watch (freeze, the back/forward cache, the page going away); none for a child realm. */
	lifecycle: HubLifecycleTargets | undefined
}
