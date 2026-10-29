import { TEST_STORAGE_KEY } from './test-storage.constants'

import type { TestStorageHolder } from './test-storage.types'
import type { StorageParam } from '@/project'

/** The process's default store of the test helpers (`useTestStorage`); `undefined` when none is set. */
export function readTestStorage(): StorageParam | undefined {
	const holder = globalThis as TestStorageHolder
	return holder[TEST_STORAGE_KEY]
}
