import { withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { testStoreFor } from '@/test/test-storage'

import type { StorageParam } from './types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// The store is a switch: what a project does through its public API is the same whichever store it runs on. These
// are the storages the switch's cases run on.

/** The dialecte config every switch case's projects are of. */
export const SWITCH_CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

/** The dialecte the cases' projects are of, unless a case names another. */
export const SWITCH_DIALECTE_ID = 'core/test'

/**
 * Every storage of the switch, by name: how a project of a case gets it, by its name and dialecte, the engine's hooks
 * given (SQLite runs its own).
 */
export const SWITCH_STORAGES: Record<
	string,
	(params: {
		name: string
		dialecteId: string
		hooks?: DialecteHooks<AnyDialecteConfig>
	}) => Promise<StorageParam>
> = {
	'in memory': async function inMemory() {
		return { type: 'inMemory' }
	},
	'on IndexedDB': async function local() {
		return { type: 'local' }
	},
	'on SQLite (the engine in this realm)': function sqliteInProcess({ name, dialecteId, hooks }) {
		withSqliteStorage()
		return testStoreFor({
			storage: { type: 'sqlite' },
			name,
			dialecte: {
				id: dialecteId,
				configs: { default: SWITCH_CONFIG },
				defaultConfigKey: 'default',
				createHooks: function engineHooks() {
					return hooks ?? {}
				},
			},
		})
	},
}
