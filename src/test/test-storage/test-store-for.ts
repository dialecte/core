import { EngineStore } from '@/store/engine/engine-store'

import type { TestStoreDialecte } from './test-storage.types'
import type { StorageParam } from '@/project'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/**
 * The storage a test project opens on, from its kind: `sqlite` is the SQLite engine run in this realm (in process,
 * on a file in memory: the test helpers know the dialecte, not its engine worker), the same engine a project on
 * `sqlite` storage reaches in a worker; every other kind as it is. The engine and sqlite-wasm are loaded only for a
 * test on `sqlite`.
 */
export async function testStoreFor<GenericConfig extends AnyDialecteConfig>(params: {
	storage: StorageParam
	/** The test project's name. */
	name: string
	dialecte: TestStoreDialecte<GenericConfig>
	/** Measure the import's and the export's stages (`dev.perf`). */
	perf?: boolean
}): Promise<StorageParam> {
	const { storage, name, dialecte, perf } = params
	if (storage.type !== 'sqlite') return storage
	const { createInProcessConnector } = await import('@/store/sqlite/adapter/in-process-link')
	// erased to the config-agnostic shape the engine imports with, at this one boundary
	const runtime = {
		configs: dialecte.configs as Record<string, AnyDialecteConfig>,
		defaultConfigKey: dialecte.defaultConfigKey,
		// the engine's own hooks, as a worker's engine makes them
		hooks: dialecte.createHooks?.() as DialecteHooks<AnyDialecteConfig> | undefined,
		perf,
	}
	const connector = createInProcessConnector({ name, dialecteId: dialecte.id, runtime })
	return { type: 'custom', store: new EngineStore({ name, connector }) }
}
