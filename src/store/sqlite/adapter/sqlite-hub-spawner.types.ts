import type { SqliteEngineSettings } from '../runtime/runtime.types'
import type { RealmEngineSpawner } from '@/store/engine/hub/realm-host.types'

/** A SQLite engine a page can start for the hub: the spawner's own fields, the engine's options beside. */
export type SqliteHubSpawnerParams = Omit<RealmEngineSpawner, 'settings'> &
	Omit<SqliteEngineSettings, 'wasmUrl'>
