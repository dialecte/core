import { toDialecteError } from './errors'

/** The key a promise rejected with (the error's text when it carries none); `resolved` when it did not reject. */
export async function rejectionKey(params: { action: Promise<unknown> }): Promise<string> {
	try {
		await params.action
		return 'resolved'
	} catch (thrown) {
		return toDialecteError(thrown)?.key ?? String(thrown)
	}
}

/**
 * The errors only SQLite storage raises, each with its code: declared by the SQLite side (`SQLITE_ERRORS` from
 * `@dialecte/core/sqlite`), not by core's catalogue. The codes are the ones consumers already match.
 */
export const SQLITE_DECLARED_ERROR_CODES = {
	STORE_PROTOCOL_MISMATCH: 'D1012',
	STORE_REALM_ID_TAKEN: 'D1013',
	STORE_REALM_UNKNOWN: 'D1014',
	STORE_HUB_SPAWNERS_FIXED: 'D1019',
	STORE_SQLITE_ENGINE_FIXED: 'D1020',
	PROJECT_LAYOUT_OUTDATED: 'D7005',
	PROJECT_ENGINE_UNAVAILABLE: 'D7006',
	PROJECT_ENGINE_BUSY: 'D7007',
	PROJECT_DATABASE_LOST: 'D7012',
	PROJECT_ENGINE_NOT_DECLARED: 'D7015',
	PROJECT_SQLITE_ENGINE_NOT_REGISTERED: 'D7017',
} as const

/** The key core's catalogue gave up for a generic one: SQLite storage was imported or not, a store kind is registered or not. */
export const RETIRED_SQLITE_ERROR_KEY = 'PROJECT_SQLITE_NOT_IMPORTED'
