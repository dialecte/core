import { readTestStorage } from './read-test-storage'
import { DEFAULT_TEST_STORAGE } from './test-storage.constants'

import type { StorageParam } from '@/project'

/**
 * The store a test project opens on: the call's own, else the process's default (`useTestStorage`), else the
 * local store. Core's own tests that open a `Project` directly take it, so they follow the runner too.
 */
export function resolveTestStorage(params: { storage?: StorageParam }): StorageParam {
	return params.storage ?? readTestStorage() ?? DEFAULT_TEST_STORAGE
}
