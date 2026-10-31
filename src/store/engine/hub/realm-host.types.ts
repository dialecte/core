import type { EngineControl } from '../client/client.types'
import type { RealmToHubMessage } from './hub-protocol.types'

/** An engine a realm can start for the hub: its dialecte, the version that dialecte runs, its worker. */
export type HubEngineSpawner = {
	dialecteId: string
	dialecteVersion: string
	/** The address of the dialecte's engine worker (its `?worker&url` export). */
	engineUrl: string
	/** What the engine's kind needs to open, handed to it as is (the SQLite engine: its wasm file). */
	settings: unknown
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
}

/** One engine a realm hosts for the hub. */
export type HostedEngine = {
	project: string
	dialecteId: string
	generation: number
	worker: Worker
	control: EngineControl
	/** Set once the realm ends it itself (released, the page suspending): its end is no news for the hub. */
	ended: boolean
	/** The page's request of the engine lock, granted once the worker no longer holds it. */
	watch: AbortController | undefined
}

/** The engines a realm hosts, driven by what the hub asks; each answered back on the realm's control port. */
export type RealmHost = {
	spawn: (params: {
		project: string
		dialecteId: string
		generation: number
		openBudgetMs: number
		expectedCreationId?: string
	}) => void
	adopt: (params: {
		project: string
		generation: number
		adoptionId: number
		clientId: string
		port: MessagePort
	}) => void
	/** Settles once the engine has released the client (its port answers no more), or is gone. */
	clientGone: (params: { project: string; generation: number; clientId: string }) => Promise<void>
	release: (params: { project: string; generation: number }) => void
	/** Every engine ended at once (the page goes away or freezes): their workers terminated. */
	endAll: () => void
}

export type RealmHostParams = {
	spawners: HubEngineSpawner[]
	/** Say something to the hub on the realm's control port. */
	report: (message: RealmToHubMessage) => void
	/**
	 * How long an engine may take to adopt a client (`ENGINE_HEARTBEAT_TIMEOUT_MS` when absent): one silent that
	 * long is lost, the adoption reported failed.
	 */
	adoptBudgetMs?: number
}
