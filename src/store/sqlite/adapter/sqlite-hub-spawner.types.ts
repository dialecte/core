import type { SqliteEngineSettings } from '../runtime/runtime.types'
import type { HubEngineSpawner } from '@/store/engine/hub/realm-host.types'

/** A SQLite engine a page can start for the hub: the spawner's own fields, the engine's options beside. */
export type SqliteHubSpawnerParams = Omit<HubEngineSpawner, 'settings'> &
	Omit<SqliteEngineSettings, 'wasmUrl'>
