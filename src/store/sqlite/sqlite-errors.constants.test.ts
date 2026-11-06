import { SQLITE_ERRORS } from './sqlite-errors.constants'

import { describe, expect, it } from 'vitest'

import { createDialecteError, isKnownDialecteError, toDialecteError } from '@/errors'
import { SQLITE_DECLARED_ERROR_CODES } from '@/errors/errors.fixtures'

describe('SQLITE_ERRORS', () => {
	const declared = Object.entries(SQLITE_DECLARED_ERROR_CODES)

	for (const [key, code] of declared) {
		it(`${key} → declared with its code ${code}, unchanged`, () => {
			const catalogue: Record<string, { key: string; code: string } | undefined> = SQLITE_ERRORS
			expect({ key: catalogue[key]?.key, code: catalogue[key]?.code }).toEqual({ key, code })
		})
	}
})

describe('an error the SQLite side declared, read by a consumer', () => {
	for (const [key, code] of Object.entries(SQLITE_DECLARED_ERROR_CODES)) {
		it(`${key} → known once the SQLite catalogue is named, unknown without it`, () => {
			const error = toDialecteError(
				createDialecteError({ key, code, message: key }, { detail: 'from the wire, as data' }),
			)
			if (!error) throw new Error('not a dialecte error')

			expect({
				withoutCatalogue: isKnownDialecteError(error, { catalogues: [] }),
				withSqliteCatalogue: isKnownDialecteError(error, { catalogues: [SQLITE_ERRORS] }),
			}).toEqual({ withoutCatalogue: false, withSqliteCatalogue: true })
		})
	}
})
