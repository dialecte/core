import type { EngineApi } from './engine.types'

/** One connection of a store to its project's engine. */
export type EngineLink = {
	/** The engine serving the project now: a later call may answer another one, started since. */
	engine: () => Promise<EngineApi>
	/**
	 * Release the connection; the engine closes once no connection is left. Idempotent; the released
	 * connection reaches no engine after (`STORE_CLOSED`).
	 */
	close: () => void
}

/** What a connector's destroy is handed: the destroying store's own connection, when it has one. */
export type EngineDestroyParams = { own?: OwnEngineLink }

/** The destroying store's own connection: `letGo` releases it, the store forgetting it, once the destroy goes ahead. */
export type OwnEngineLink = { link: EngineLink; letGo: () => void }

/** How a store reaches its project's engine, and how the project is deleted. */
export type EngineConnector = {
	connect: () => Promise<EngineLink>
	/**
	 * Delete the project's file, its engine closed first; the next connection starts on a new file. `own`,
	 * the destroying store's own connection, does not count against it, and is let go only once the destroy
	 * goes ahead: refused, it is kept as it was.
	 */
	destroy: (params?: EngineDestroyParams) => Promise<void>
}

export type EngineStoreParams = {
	/** The project's name. */
	name: string
	connector: EngineConnector
}
