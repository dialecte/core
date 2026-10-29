import type { StorageParam } from '@/project'

/**
 * Where the default store of the test helpers is kept for the process: on `globalThis`, so every copy of the
 * test entry a runner loads (its own build, a pre-bundled one) reads the same default.
 */
export const TEST_STORAGE_KEY = Symbol.for('@dialecte/core/test:storage')

/** The store a test project opens on when neither the call nor the process names one: the project's own default. */
export const DEFAULT_TEST_STORAGE: StorageParam = { type: 'local' }
