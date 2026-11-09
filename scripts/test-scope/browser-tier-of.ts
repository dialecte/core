import { matchesGlob } from 'node:path'

import { STORE_TEST_FILE_PATTERNS } from './test-scope.constants'

import type { BrowserTier } from './test-scope.types'

/** The tier of a browser-only test file: T4 when it is a store test file, T3 otherwise. */
export function browserTierOf(params: { path: string }): BrowserTier {
	const { path } = params
	return STORE_TEST_FILE_PATTERNS.some((pattern) => matchesGlob(path, pattern)) ? 'T4' : 'T3'
}
