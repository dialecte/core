import type { EngineConnector } from '../engine/engine-store.types'

/** A project on `sqlite` storage: its name, its dialecte and the engine its factory gives. */
export type SqliteConnectorParams = {
	name: string
	dialecteId: string
	dialecteVersion: string
	/** The address of the dialecte's engine worker. */
	engineUrl: string
	/** Measure the import's and the export's stages in the engine (`dev.perf`). */
	perf?: boolean
}

/** What the SQLite connector's module gives, loaded at a project's first connect. */
export type SqliteConnectorModule = {
	createSqliteConnector: (params: SqliteConnectorParams) => EngineConnector
}
