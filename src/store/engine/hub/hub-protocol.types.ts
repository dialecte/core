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
	| { type: 'open'; project: string; dialecteId: string; dialecteVersion: string }
	| { type: 'leave'; project: string }
	| { type: 'destroy'; project: string }
	| { type: 'destroyed'; project: string }
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
	| { type: 'engine-opened'; project: string; generation: number }
	| {
			type: 'engine-open-failed'
			project: string
			generation: number
			/** The error's catalog key, when it has one (`undefined` for a spawn that failed in the host). */
			key: string | undefined
			error: ThrownData
	  }
	| { type: 'engine-ended'; project: string; generation: number }
	| { type: 'client-adopted'; adoptionId: number }
	| { type: 'client-adopt-failed'; adoptionId: number }

/** What the hub sends a realm. */
export type HubToRealmMessage =
	| { type: 'welcome'; realmId: string }
	/** The hello refused: the realm is not connected. */
	| { type: 'hello-refused'; error: ThrownData }
	| { type: 'engine-ready'; project: string; generation: number; port: MessagePort }
	| { type: 'engine-lost'; project: string; generation: number }
	| { type: 'open-refused'; project: string; error: ThrownData }
	| { type: 'destroy-granted'; project: string }
	| { type: 'destroy-refused'; project: string; error: ThrownData }
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
	  }
	| {
			type: 'adopt-client'
			project: string
			generation: number
			adoptionId: number
			/** The client's id in the engine: its realm id. */
			clientId: string
			port: MessagePort
	  }
	| { type: 'client-gone'; project: string; generation: number; clientId: string }
	| { type: 'release-engine'; project: string; generation: number }
