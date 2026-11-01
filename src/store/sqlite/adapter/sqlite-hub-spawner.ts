import { sqliteEngineSettings } from './sqlite-engine-settings'

import type { SqliteHubSpawnerParams } from './sqlite-hub-spawner.types'
import type { RealmEngineSpawner } from '@/store/engine/hub/realm-host.types'

/**
 * A dialecte's SQLite engine as a page offers to start it for the hub: its engine worker
 * (`serveDialecteEngine`), opened on the consumer's one SQLite wasm file.
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
