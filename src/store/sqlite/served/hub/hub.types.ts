import type { SqliteRaisedErrorKey } from '../../sqlite-errors.types'

// ── Router input ─────────────────────────────────────────────────────────────

/** A dialecte whose engine a realm can start, with the version of the dialecte that engine runs. */
export type HubSpawner = { dialecteId: string; dialecteVersion: string }

/** What an engine said when it could not open: its catalog key, read by the router, and its error as it came. */
export type EngineOpenFailure = { key: string | undefined; error: unknown }

/**
 * What reaches the router. Every event carries the hub's monotonic clock (`now`, ms): the router
 * reads no clock of its own.
 */
export type HubEvent =
	| {
			/** A realm says who it is; `parentRealmId` when it speaks on a port another realm bound for it. */
			type: 'hello'
			now: number
			realmId: string
			protocol: number
			topLevel: boolean
			spawners: HubSpawner[]
			parentRealmId?: string
	  }
	| {
			/** A realm adds engines it can start, after its hello (a child realm's are ignored: it hosts none). */
			type: 'spawners'
			now: number
			realmId: string
			spawners: HubSpawner[]
	  }
	| {
			type: 'open'
			now: number
			realmId: string
			project: string
			dialecteId: string
			dialecteVersion: string
			/** The creation id of the project the realm had, coming back to it. */
			expectedCreationId?: string
	  }
	| {
			/** A realm closes its link to a project. */ type: 'leave'
			now: number
			realmId: string
			project: string
			dialecteId: string
	  }
	| {
			/**
			 * The realm's lock was granted: it died, or it suspended and let the lock go. For a child
			 * realm: its parent unbound it.
			 */
			type: 'realm-gone'
			now: number
			realmId: string
	  }
	| {
			type: 'engine-opened'
			now: number
			project: string
			dialecteId: string
			generation: number
			/** The id the project's file was created with. */
			creationId: string
	  }
	| {
			/** The host saw its engine worker end without being asked (crash, out of memory). */
			type: 'engine-ended'
			now: number
			project: string
			dialecteId: string
			generation: number
	  }
	| {
			/** The engine could not open; a spawn that failed in its host comes with `key: undefined`. */
			type: 'engine-open-failed'
			now: number
			project: string
			dialecteId: string
			generation: number
			failure: EngineOpenFailure
	  }
	| {
			/** A realm asks to destroy the project: granted once no other realm is its client. */
			type: 'destroy'
			now: number
			realmId: string
			project: string
			dialecteId: string
	  }
	| {
			/** The realm granted the destroy has done it (or given up): the project may open again. */
			type: 'destroyed'
			now: number
			realmId: string
			project: string
			dialecteId: string
	  }
	| {
			/**
			 * A realm that cannot store (a child whose storage is refused) asks to destroy the project: granted as a
			 * `destroy` is, its files deleted by a realm that runs an engine of the dialecte.
			 */
			type: 'destroy-elsewhere'
			now: number
			realmId: string
			project: string
			dialecteId: string
			/** The version the asking realm runs: a realm deleting the files at that version is preferred. */
			dialecteVersion: string
	  }
	| {
			/** The realm asked to delete a project's files for another has done it, or failed with `error`. */
			type: 'files-deleted'
			now: number
			realmId: string
			project: string
			dialecteId: string
			error?: unknown
	  }
	| { /** The deadline the router last answered as `wakeAt` came. */ type: 'tick'; now: number }

// ── Router output ────────────────────────────────────────────────────────────

/** Why the hub answers a hello or an open with no: its own reason, or the engine's error as it came. */
export type HubRefusal =
	| { origin: 'hub'; key: SqliteRaisedErrorKey; detail: string; meta: Record<string, unknown> }
	| { origin: 'engine'; error: unknown }

/** What the router asks the hub worker to do: realms by realm id, engines by project and generation. */
export type HubCommand =
	| { type: 'welcome'; realmId: string }
	/** Forget the realm and close its control port. */
	| { type: 'drop-realm'; realmId: string }
	| { type: 'refuse-hello'; realmId: string; refusal: HubRefusal }
	/** Request the realm's lock; its grant is the realm's `realm-gone`. */
	| { type: 'watch-realm-lock'; realmId: string }
	| {
			type: 'spawn-engine'
			realmId: string
			project: string
			dialecteId: string
			generation: number
			openBudgetMs: number
			/** The creation id every client waiting expects (realms coming back to the project), if they agree. */
			expectedCreationId?: string
	  }
	/** One channel: an end to the engine for this client, the other to the realm as its engine port. */
	| {
			type: 'connect-client'
			project: string
			dialecteId: string
			generation: number
			realmId: string
			/** The id the engine's project was created with: the client checks it is the project it had. */
			creationId: string
	  }
	/** The client's engine is gone: the client waits for the hub's next answer. */
	| {
			type: 'engine-lost'
			realmId: string
			project: string
			dialecteId: string
			generation: number
	  }
	| {
			type: 'refuse-open'
			realmId: string
			project: string
			dialecteId: string
			refusal: HubRefusal
	  }
	/** Tell the engine one of its clients is gone: it aborts what that client started. */
	| {
			type: 'client-gone'
			project: string
			dialecteId: string
			generation: number
			realmId: string
	  }
	/** Have the host end that engine (close it, terminate its worker) and forget its control port. */
	| {
			type: 'release-engine'
			project: string
			dialecteId: string
			generation: number
			hostRealmId: string
	  }
	/** The realm may destroy the project now: no engine runs it, opens wait until `destroyed`. */
	| { type: 'destroy-granted'; realmId: string; project: string; dialecteId: string }
	| {
			type: 'refuse-destroy'
			realmId: string
			project: string
			dialecteId: string
			refusal: HubRefusal
	  }
	/** The realm's leave handled: it counts no more for the project (a destroy asked after it is not refused for it). */
	| { type: 'left'; realmId: string; project: string; dialecteId: string }
	/** Delete the project's files for the realm that asked (`destroy-elsewhere`); answer `files-deleted`. */
	| { type: 'delete-files'; realmId: string; project: string; dialecteId: string }
	/** The project the realm asked to destroy elsewhere is deleted. */
	| { type: 'destroyed-elsewhere'; realmId: string; project: string; dialecteId: string }

export type HubOutput = {
	commands: HubCommand[]
	/** The earliest deadline the router holds: send `tick` then. */
	wakeAt: number | undefined
}

export type HubRouter = { handle: (event: HubEvent) => HubOutput }

// ── Router state ─────────────────────────────────────────────────────────────

export type HubRealm = {
	realmId: string
	topLevel: boolean
	/** Dialecte id -> the version its engine runs. Empty for a child realm: a client only. */
	spawners: Map<string, string>
	/** A child realm lives as long as the realm that bound its port. */
	parentRealmId: string | undefined
	/** Connection order, the last tiebreak of an election. */
	order: number
}

/** A realm that can host an engine of a dialecte, and the version of the dialecte it would run. */
export type HubCandidate = { realm: HubRealm; dialecteVersion: string }

export type HubEngine = {
	hostRealmId: string
	generation: number
	/** The version of the dialecte the engine runs: its host's. */
	dialecteVersion: string
	status: 'opening' | 'ready'
	/** The id the project's file was created with, once the engine opened. */
	creationId: string | undefined
	/** The creation id it was told to expect (its clients coming back to the project), if any. */
	expectedCreationId: string | undefined
}

/** A project exists while it has an engine, opening or ready. */
export type HubProject = {
	project: string
	dialecteId: string
	/** Realm id -> the dialecte version the realm runs. Every client holds a port while the engine is ready. */
	clients: Map<string, string>
	/** Realm id -> the creation id a client coming back to the project expects (none for a client opening it anew). */
	expectations: Map<string, string>
	engine: HubEngine
	/** While the engine opens for waiting clients: when they are answered at the latest. */
	openDeadline: number | undefined
	/** While no client is left: when the engine is told to close. */
	idleDeadline: number | undefined
	/** The hosts an engine of this open window failed busy on, oldest first. */
	triedHosts: string[]
}

/** A project a realm is destroying: the opens made meanwhile wait, in their order, until it is done. */
export type HubHold = {
	project: string
	dialecteId: string
	/** The realm destroying it. */
	realmId: string
	/** The realm deleting its files for it (`destroy-elsewhere`); none: the destroying realm deletes them itself. */
	deleterRealmId?: string
	opens: Map<string, Extract<HubEvent, { type: 'open' }>>
}

export type HubState = {
	realms: Map<string, HubRealm>
	/** Project key (`projectKeyOf`: dialecte and name) -> the project and its engine. */
	projects: Map<string, HubProject>
	/** Project key (`projectKeyOf`) -> the destroy running on it; such a project has no entry in `projects`. */
	holds: Map<string, HubHold>
	/** One counter for the hub: a generation never repeats, not even for a project opened again. */
	nextGeneration: number
	nextOrder: number
}

/** One event being handled: the state, its time, and the commands answered so far. */
export type HubStep = { state: HubState; now: number; commands: HubCommand[] }
