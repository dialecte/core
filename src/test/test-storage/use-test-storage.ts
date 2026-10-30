import { TEST_STORAGE_KEY } from './test-storage.constants'

import type { TestStorageHolder } from './test-storage.types'
import type { StorageParam } from '@/project'

/**
 * The store the test helpers open their projects on when a call names none, for the whole process: the
 * runner (`createTestRunner`), `createTestProject`, `createTestHelpers` and `createTestContext`. A
 * runner's setup file calls it (`useTestStorage({ type: 'inMemory' })` for a node test project); a test
 * file never does. A call's own `storage` (on the helper or on one call) still wins; `undefined` gives
 * the project's own default back (the local store).
 */
export function useTestStorage(storage: StorageParam | undefined): void {
	const holder = globalThis as TestStorageHolder
	holder[TEST_STORAGE_KEY] = storage
}
