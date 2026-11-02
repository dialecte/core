import { TEST_STORAGE_KEY } from './test-storage.constants'

import type { TestStorageHolder } from './test-storage.types'
import type { StorageParam } from '@/project'

/**
 * The store the test helpers open their projects on when a call names none, for the whole process: the
 * runner (`createTestRunner`), `createTestProject` and `createTestHelpers`. A
 * runner's setup file calls it (`useTestStorage({ type: 'inMemory' })` for a node test project); a test
 * file never does. A call's own `storage` (on the helper or on one call) still wins; `undefined` gives
 * the project's own default back (the local store). In the test helpers `{ type: 'sqlite' }` is the SQLite
 * engine run in the test's own process (its file in memory), in node as in a browser, once the setup file
 * imports `@dialecte/core/sqlite` (as an app opts into SQLite storage).
 *
 * @intent choose the store tests run on, run node tests on the in-memory store, run tests on SQLite
 */
export function useTestStorage(storage: StorageParam | undefined): void {
	const holder = globalThis as TestStorageHolder
	holder[TEST_STORAGE_KEY] = storage
}
