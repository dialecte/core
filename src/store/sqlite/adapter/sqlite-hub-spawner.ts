import { sqliteEngineSettings } from './sqlite-engine-settings'

import type { SqliteHubSpawnerParams, SqliteHubSpawnersOfParams } from './sqlite-hub-spawner.types'
import type { RealmEngineSpawner } from '@/store/engine/hub/realm-host.types'

/**
 * A dialecte's SQLite engine as a page offers to start it for the hub: its engine worker
 * (`serveSqliteEngine`), opened on the consumer's one SQLite wasm file.
 */
export function sqliteHubSpawner(params: SqliteHubSpawnerParams): RealmEngineSpawner {
	const { dialecteId, dialecteVersion, engineUrl, perf, options, progressBeatOps } = params
	return {
		dialecteId,
		dialecteVersion,
		engineUrl,
		perf,
		settings: async function settingsOfEngine() {
			return sqliteEngineSettings({ options, progressBeatOps })
		},
	}
}

/**
 * The engines a page offers the hub from what the app registered: one per dialecte, all on the app's one worker file,
 * only the opening project's own dialecte measured when that project is. None registered: none.
 */
export function sqliteHubSpawnersOf(params: SqliteHubSpawnersOfParams): RealmEngineSpawner[] {
	const { registration, own } = params
	if (!registration) return []
	return registration.dialectes.map(function spawnerOf({ id, version }) {
		return sqliteHubSpawner({
			dialecteId: id,
			dialecteVersion: version,
			engineUrl: registration.url,
			perf: id === own?.dialecteId ? own.perf : undefined,
		})
	})
}
