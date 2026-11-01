import type { ThrownData } from '../wire/wire.types'
import type { HubSpawner } from './hub.types'

/*
 * What a realm and the hub say to each other on a realm's control port. A realm says hello first; the
 * hub answers nothing else until it has welcomed it. Refusals travel as data (an error's envelope),
 * rebuilt on the realm's side.
 */

/** What a realm sends the hub. */
export type RealmToHubMessage =
	| {
			type: 'hello'
			protocol: number
			realmId: string
			topLevel: boolean
			spawners: HubSpawner[]
	  }
	/** Engines the realm can start from now on, beside those of its hello (a child realm's are ignored). */
	| { type: 'spawners'; spawners: HubSpawner[] }
	| {
			type: 'open'
			project: string
			dialecteId: string
			dialecteVersion: string
			/** The creation id of the project the realm had, coming back to it. */
			expectedCreationId?: string
	  }
	| { type: 'leave'; project: string; dialecteId: string }
	| { type: 'destroy'; project: string; dialecteId: string }
	| { type: 'destroyed'; project: string; dialecteId: string }
	/** A realm that cannot store destroys the project: the hub has a realm that can delete its files. */
	| { type: 'destroy-elsewhere'; project: string; dialecteId: string; dialecteVersion: string }
	/** A bound child asking whether its hub lives (it holds no lock to watch it): a hub answers `pong`. */
	| { type: 'ping' }
	/** The project's files deleted as the hub asked (`delete-files`), or what failed. */
	| { type: 'files-deleted'; project: string; dialecteId: string; error?: ThrownData }
	/**
	 * Said on a port a parent bound for a child, before any hello, when the child lets it go unused (a newer one
	 * handed to it): the hub forgets that binding. A hub of the same protocol that does not know it ignores it.
	 */
	| { type: 'port-unused' }
	/** A port for a child realm (one with no hub of its own), bound to this realm under `bindingId`. */
	| { type: 'bind-child'; bindingId: string; port: MessagePort }
	/** The child realm bound under `bindingId` is gone (its iframe removed): the hub treats it as dead. */
	| { type: 'unbind-child'; bindingId: string }
	// what a host realm reports of the engines it runs
	| {
			type: 'engine-opened'
			project: string
			dialecteId: string
			generation: number
			creationId: string
	  }
	| {
			type: 'engine-open-failed'
			project: string
			dialecteId: string
			generation: number
			/** The error's catalog key, when it has one (`undefined` for a spawn that failed in the host). */
			key: string | undefined
			error: ThrownData
	  }
	| { type: 'engine-ended'; project: string; dialecteId: string; generation: number }
	| { type: 'client-adopted'; adoptionId: number }
	| { type: 'client-adopt-failed'; adoptionId: number }

/** What the hub sends a realm. */
export type HubToRealmMessage =
	/** Welcomed: `hubLock` names the lock the hub holds for its life - granted to a realm, the hub is gone. */
	| { type: 'welcome'; realmId: string; hubLock: string }
	/** The hello refused: the realm is not connected. */
	| { type: 'hello-refused'; error: ThrownData }
	| {
			type: 'engine-ready'
			project: string
			dialecteId: string
			generation: number
			port: MessagePort
			/** The id the engine's project was created with. */
			creationId: string
	  }
	| { type: 'engine-lost'; project: string; dialecteId: string; generation: number }
	| { type: 'open-refused'; project: string; dialecteId: string; error: ThrownData }
	| { type: 'destroy-granted'; project: string; dialecteId: string }
	/** The realm's leave of the project handled: it counts no more for it. */
	| { type: 'left'; project: string; dialecteId: string }
	| { type: 'destroy-refused'; project: string; dialecteId: string; error: ThrownData }
	/** The hub lives: the answer to a `ping`. */
	| { type: 'pong' }
	/** The project this realm asked to destroy elsewhere is deleted. */
	| { type: 'destroyed-elsewhere'; project: string; dialecteId: string }
	/** Delete the project's files for a realm that cannot store; answer `files-deleted`. */
	| { type: 'delete-files'; project: string; dialecteId: string }
	/**
	 * Said to a child realm before its port closes, when the hub drops it with the page that bound it (that
	 * page gone, frozen, or unbinding it): its calls are refused until a new port binds it again. A realm
	 * of the same protocol that does not know it ignores it.
	 */
	| { type: 'dropped' }
	// what the hub asks of a host realm
	| {
			type: 'spawn-engine'
			project: string
			dialecteId: string
			generation: number
			openBudgetMs: number
			expectedCreationId?: string
	  }
	| {
			type: 'adopt-client'
			project: string
			dialecteId: string
			generation: number
			adoptionId: number
			/** The client's id in the engine: its realm id. */
			clientId: string
			port: MessagePort
	  }
	| {
			type: 'client-gone'
			project: string
			dialecteId: string
			generation: number
			clientId: string
	  }
	| { type: 'release-engine'; project: string; dialecteId: string; generation: number }
