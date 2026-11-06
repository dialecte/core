import { SQLITE_STORAGE_KIND } from './sqlite-storage-kind'

import { describe, expect, it } from 'vitest'

describe('the sqlite storage kind', () => {
	it('its id → the literal written out: copies of the library tell kinds apart by it, so a change must be seen', () => {
		expect(SQLITE_STORAGE_KIND.id).toBe('@dialecte/core/sqlite')
	})
})
