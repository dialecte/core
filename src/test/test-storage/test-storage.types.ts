import type { TEST_STORAGE_KEY } from './test-storage.constants'
import type { StorageParam } from '@/project'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/** The process's default store of the test helpers, as kept on `globalThis`. */
export type TestStorageHolder = { [TEST_STORAGE_KEY]?: StorageParam }

/** The dialecte a test project's store holds: its id, its configs and how its hooks are made. */
export type TestStoreDialecte<GenericConfig extends AnyDialecteConfig> = {
	id: string
	configs: Readonly<Record<string, GenericConfig>>
	defaultConfigKey: string
	createHooks?: () => DialecteHooks<GenericConfig>
}
