import type { SqliteConnectorParams, SqliteEngineRegistration } from '../../sqlite-storage.types'

/** A project on `sqlite` storage, and where its connector reads the engine the app registered. */
export type CreateSqliteConnectorParams = SqliteConnectorParams & {
	/** Read at each connection and destroy, so a project built before the registration and opened after it works. */
	engine: () => SqliteEngineRegistration | undefined
}
