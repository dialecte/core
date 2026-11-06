import type { TestStoreProvider } from './test-storage.types'

/**
 * The test stores core's test entry provides, by storage type: the ones a kind registered elsewhere does not carry
 * itself (SQLite's in-process engine, which a page importing `@dialecte/core/sqlite` must never reach).
 */
export const TEST_STORE_PROVIDERS = new Map<string, TestStoreProvider>()
