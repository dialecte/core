import type { EngineClient } from '../client/client.types'
import type { LinkNotice } from '../engine-store.types'
import type { RealmToHubMessage } from './hub-protocol.types'
import type { HubEngineSpawner, RealmEngineSpawner } from './realm-host.types'

export type ConnectHubParams = {
	/**
	 * The engines this page can start for the hub: each dialecte's `factory.spawner` (a spawner whose worker is of
	 * another origin is left out). A later call adds the engines the page does not run yet.
	 */
	spawners?: HubEngineSpawner[]
}

/** How the realm connects: the engines it can start, with what each opens with. */
export type HubConnectionOptions = {
	spawners?: RealmEngineSpawner[]
}

/** The realm's global object as the hub connection is kept on it, under the protocol's key. */
export type HubRegistry = Partial<Record<symbol, Promise<HubConnection | undefined>>>

/**
 * What a page holds of its connection to the hub: its realm id, ports for the documents that cannot
 * reach the hub themselves, and a call each time it is welcomed back. A child bound to a page that
 * freezes is dropped by the hub with the page and told: its calls are refused `STORE_ENGINE_LOST`
 * (`realm-dropped`) until the page, welcomed back (`onRejoined`), hands it a new port from
 * `createHubPort` and the child calls `adoptHubPort` with it.
 */
export type HubRealm = Pick<HubConnection, 'realmId' | 'createHubPort' | 'onRejoined'>

/** This realm's connection to the origin's hub, shared by every copy of the library in the realm. */
export type HubConnection = {
	/** This realm instance's id (a new one after the page came back from a freeze or the cache). */
	realmId: () => string
	/**
	 * Engines the realm can start from now on, beside those it runs: the hub told at once when welcomed (else in the
	 * next hello). A dialecte it runs at another version is refused `STORE_HUB_SPAWNERS_FIXED`, nothing added; one it
	 * runs already, or any for a child bound through `adoptHubPort` (it hosts none), adds nothing.
	 */
	addSpawners: (params: { spawners: RealmEngineSpawner[] }) => void
	/** The realm's link to a project's engine: one per project, shared by the realm's connections to it. */
	openProject: (params: HubProjectParams) => HubProjectLink
	/**
	 * Destroy a project once the hub grants it (no other view uses it): `destroy` deletes the files. `own`,
	 * the destroying connection's link, does not count, and is let go once the destroy goes ahead.
	 */
	destroyProject: (params: {
		project: string
		dialecteId: string
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
	/**
	 * `listener` called each time the realm is welcomed back after a freeze, the back/forward cache or
	 * being dropped - not on its first join: the moment to bind its children again (`createHubPort`).
	 * Answers its unsubscribe.
	 */
	onRejoined: (listener: () => void) => () => void
	/**
	 * A child realm takes `port` as the one it joins on next, as a new realm instance, its links kept: at
	 * once if the hub has dropped it with the page that bound it, else once it does (that page may be back
	 * first); a port it held for that is let go. Answers whether it took it: a page, or a connection ended
	 * for good, takes none.
	 */
	adoptPort: (params: { port: MessagePort }) => boolean
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
	/**
	 * `listener` told every change the project's engine announces to the realm, and `resync` once the realm reached
	 * another engine of it; until released. Answers the unsubscribe.
	 */
	onNotice: (listener: (notice: LinkNotice) => void) => () => void
	/**
	 * This connection done with the project; the realm leaves it with its last connection, settled once the hub
	 * acknowledged the leave - from then on no destroy is refused for this realm (at once when another connection of
	 * the realm still uses it, or the hub was never asked).
	 */
	release: () => Promise<void>
}

/** The destroying connection's own link, and how to let it go (its store forgetting it). */
export type OwnHubLink = { link: HubProjectLink; letGo: () => Promise<void> }

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
	/** What the realm's links of the project listen with: each change of its engine, and each resync. */
	listeners: Set<(notice: LinkNotice) => void>
	/** An engine was reached once already: the next one is announced with a resync. */
	reached: boolean
	/** The hub was asked for the project and has not refused it since. */
	asked: boolean
	current: { generation: number; client: EngineClient } | undefined
	waiters: EngineWaiter[]
	/** A refusal that holds for the rest of the link. */
	refusal: unknown
	/**
	 * The id the project's file was created with, from the first engine the link reached: every later engine
	 * (the realm back from a freeze, a host gone) must run that project, else the link is refused.
	 */
	creationId: string | undefined
}

/**
 * Where the realm instance stands with the hub: saying hello (its lock, then the welcome), welcomed (it
 * may ask for projects and host engines), suspended (frozen, or in the back/forward cache), or refused
 * by the hub (another protocol): done for good.
 */
export type RealmPhase = 'joining' | 'joined' | 'suspended' | 'dropped' | 'refused'

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
	spawners: RealmEngineSpawner[]
	/** Whether the realm holds a lock of its own (a child realm's liveness is its parent's). */
	holdsLock: boolean
	/** The page's lifecycle to watch (freeze, the back/forward cache, the page going away); none for a child realm. */
	lifecycle: HubLifecycleTargets | undefined
	/**
	 * Joined through a port its parent made (`adoptHubPort`), not on its own: dropped with its parent, it
	 * waits for the next port its page hands it. A realm that connected itself, top-level or not, is not. A bound
	 * realm watches no hub lock (a child of another origin shares no locks with the hub): a port its page hands it
	 * while it is still welcomed settles the leaves it waits for (the hub forgets it with its page); it joins on that
	 * port once the hub drops it.
	 */
	bound?: boolean
}

/** A join's budget, from its start: `expired` rejects once it has passed; `clear` stops it. */
export type JoinBudget = { expired: Promise<never>; clear: () => void }
