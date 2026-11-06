import { isConnectionLost } from './lost-write'

import { describe, expect, it } from 'vitest'

import { createDialecteError } from '@/errors'
import { SQLITE_ERRORS } from '@/store/sqlite/sqlite-errors.constants'

/** The refusal a store gives a call whose connection it lost: its key is not in core's catalogue yet, so it is given whole. */
const CONNECTION_LOST = {
	key: 'STORE_CONNECTION_LOST',
	code: 'D1018',
	message: 'The store lost its connection',
}

describe('isConnectionLost', () => {
	type TestCase = { thrown: unknown; expected: boolean }
	const testCases: Record<string, TestCase> = {
		'a call refused STORE_CONNECTION_LOST → lost': {
			thrown: createDialecteError(CONNECTION_LOST, {
				detail: 'the host went away',
				meta: { reason: 'host-gone' },
			}),
			expected: true,
		},
		'a call refused another key → not lost': {
			thrown: createDialecteError('STORE_UNAVAILABLE', { detail: 'no private file system' }),
			expected: false,
		},
		'a call refused PROJECT_DATABASE_LOST → not lost: the database went, not the connection': {
			thrown: createDialecteError(SQLITE_ERRORS.PROJECT_DATABASE_LOST, {
				detail: 'the database was removed',
			}),
			expected: false,
		},
		'an error that is not a dialecte error → not lost': {
			thrown: new Error('STORE_CONNECTION_LOST'),
			expected: false,
		},
		'a value that is not an error → not lost': { thrown: undefined, expected: false },
	}

	for (const [description, { thrown, expected }] of Object.entries(testCases)) {
		it(description, () => {
			expect(isConnectionLost({ thrown })).toBe(expected)
		})
	}
})
