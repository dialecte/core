import { sqliteTestStoreOf } from './sqlite-test-store'

import type { TestStoreProvider } from './test-storage.types'

/**
 * The test stores core's test entry provides, by storage type: the ones a kind registered elsewhere does not carry
 * itself (SQLite's in-process engine, which a page importing `@dialecte/core/sqlite` must never reach). Built with the
 * module, so every test helper that opens a store has them, whichever module of the test entry it was loaded from.
 */
export const TEST_STORE_PROVIDERS: ReadonlyMap<string, TestStoreProvider> = new Map([
	['sqlite', sqliteTestStoreOf],
])
