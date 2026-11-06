import { EngineStore } from '@/store/sqlite/served/engine-store'

import type { StorageKindDialecte } from '@/store/storage-kinds.types'
import type { Store } from '@/store/store.types'

/**
 * The store of a test project on `sqlite` storage: the SQLite engine run in this realm (in process, on a file in
 * memory: the test helpers know the dialecte, not its engine worker), the same engine a project on `sqlite` storage
 * reaches in a worker, behind an EngineStore. The engine and sqlite-wasm are loaded only by this call. It belongs to
 * core's test entry, not to the `sqlite` kind, so a page importing `@dialecte/core/sqlite` never reaches them; the kind
 * is still asked for first (`@dialecte/core/sqlite` imported, or the test refused `PROJECT_STORAGE_NOT_REGISTERED`).
 */
export async function sqliteTestStoreOf(params: {
	name: string
	dialecte: StorageKindDialecte
	perf?: boolean
}): Promise<Store> {
	const { name, dialecte, perf } = params
	const { createInProcessConnector } = await import('@/store/sqlite/adapter/in-process-link')
	const runtime = {
		configs: dialecte.configs,
		defaultConfigKey: dialecte.defaultConfigKey,
		// the engine's own hooks, as a worker's engine makes them
		hooks: dialecte.createHooks?.(),
		perf,
	}
	const connector = createInProcessConnector({ name, dialecteId: dialecte.id, runtime })
	return new EngineStore({ name, connector })
}
