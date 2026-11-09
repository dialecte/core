import { matchesGlob } from 'node:path'

import { BROWSER_ONLY_TEST_FILES } from '../../vitest.config.constants'
import { STORE_TEST_FILE_PATTERNS } from './test-scope.constants'

/** Every browser-only test file, in the order the vitest config lists them. */
export const BROWSER_FILES: readonly string[] = BROWSER_ONLY_TEST_FILES.map((file) => file.path)

/** The browser-only files that are not store files (T3), in the config's order. */
export const T3_FILES: readonly string[] = BROWSER_FILES.filter(function isNotStoreFile(path) {
	return !STORE_TEST_FILE_PATTERNS.some((pattern) => matchesGlob(path, pattern))
})
