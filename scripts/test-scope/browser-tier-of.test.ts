import { browserTierOf } from './browser-tier-of'

import { describe, expect, it } from 'vitest'

import type { BrowserTier } from './test-scope.types'

const CASES: Record<string, BrowserTier> = {
	'src/store/contract/store-contract.sqlite-worker.test.ts': 'T4',
	'src/store/sqlite/served/hub/hub-client.test.ts': 'T4',
	'src/store/json-values.page.test.ts': 'T4',
	'src/project/import.indexeddb.test.ts': 'T4',
	'src/test/create-test-dialecte.indexeddb.test.ts': 'T4',
	'src/utils/save-to-disk.test.ts': 'T3',
	'src/project/io/export-document.test.ts': 'T3',
	'src/xml/dom/xml-document-from-file.test.ts': 'T3',
	// a name or a folder holding the word, outside the store folder: not a store file
	'src/project/store-switch.test.ts': 'T3',
	'src/x/store/y.test.ts': 'T3',
}

describe('browserTierOf', () => {
	for (const [path, tier] of Object.entries(CASES)) {
		it(`${path}: ${tier}`, () => {
			expect(browserTierOf({ path })).toBe(tier)
		})
	}
})
