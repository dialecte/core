import type { SqliteEngineSettings } from '../runtime/runtime.types'
import type { SqliteEngineRegistration } from '../sqlite-storage.types'
import type { RealmEngineSpawner } from '@/store/sqlite/served/hub/realm-host.types'

/** A SQLite engine a page can start for the hub: the spawner's own fields, the engine's options beside. */
export type SqliteHubSpawnerParams = Omit<RealmEngineSpawner, 'settings'> &
	Omit<SqliteEngineSettings, 'wasmUrl'>

/** What the engines a page offers the hub are made from. */
export type SqliteHubSpawnersOfParams = {
	/** The engine the app registered, if any. */
	registration: SqliteEngineRegistration | undefined
	/** The project opening, whose dialecte's engine is measured when the project is (`dev.perf`). */
	own?: { dialecteId: string; perf?: boolean }
}
