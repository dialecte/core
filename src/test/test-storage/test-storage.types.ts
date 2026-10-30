import type { TEST_STORAGE_KEY } from './test-storage.constants'
import type { StorageParam } from '@/project'

/** The process's default store of the test helpers, as kept on `globalThis`. */
export type TestStorageHolder = { [TEST_STORAGE_KEY]?: StorageParam }
