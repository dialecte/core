import { registeredSqliteStorage, registerSqliteStorage } from './sqlite-storage'
import { SQLITE_STORAGE_KEY } from './sqlite-storage.constants'

import { describe, expect, it, onTestFinished } from 'vitest'

import { toDialecteError } from '@/errors'

import type { SqliteStorage, SqliteStorageHolder } from './sqlite-storage.types'

// Importing `@dialecte/core/sqlite` registers the kind: pinned by the `node-sqlite` project (its setup imports the
// entry, every Document suite then opens on it) and by the browser connector suites (they import it, and open).

function storage(): SqliteStorage {
	return {
		storeOf: function notBuilt() {
			throw new Error('not built in this case')
		},
	}
}

/** The kind registered for `north`, or the key it was refused with. */
function answerOf(): SqliteStorage | string | undefined {
	try {
		return registeredSqliteStorage({ project: 'north' })
	} catch (thrown) {
		return toDialecteError(thrown)?.key
	}
}

describe('the sqlite storage kind', () => {
	const first = storage()
	const second = storage()
	type TestCase = {
		/** What the case registers, in order, then how many of them it restores (last first). */
		registers: (SqliteStorage | undefined)[]
		restores?: number
		/** A copy of the library of the same storage version registered it (on `globalThis`, not through this module). */
		byAnotherCopy?: SqliteStorage
		expected: SqliteStorage | string
	}
	const testCases: Record<string, TestCase> = {
		'none registered → PROJECT_SQLITE_NOT_IMPORTED': {
			registers: [undefined],
			expected: 'PROJECT_SQLITE_NOT_IMPORTED',
		},
		'registered → that kind': { registers: [first], expected: first },
		'two registered, the second restored → the first': {
			registers: [undefined, first, second],
			restores: 1,
			expected: first,
		},
		'registered, then restored → none again': {
			registers: [undefined, first],
			restores: 1,
			expected: 'PROJECT_SQLITE_NOT_IMPORTED',
		},
		'registered by another copy of the library of the same storage version → that kind': {
			registers: [undefined],
			byAnotherCopy: first,
			expected: first,
		},
	}
	for (const [description, { registers, restores = 0, byAnotherCopy, expected }] of Object.entries(
		testCases,
	)) {
		it(description, () => {
			const restoring = registers.map(function registered(registeredStorage) {
				return registerSqliteStorage({ storage: registeredStorage })
			})
			onTestFinished(restoring[0]!)
			// the last `restores` registrations restored, the last first
			for (const restore of restoring.slice(restoring.length - restores).reverse()) restore()
			if (byAnotherCopy) (globalThis as SqliteStorageHolder)[SQLITE_STORAGE_KEY] = byAnotherCopy
			expect(answerOf()).toBe(expected)
		})
	}

	it('refused → its meta names the project, its detail the import to add and the other-copy cause', () => {
		onTestFinished(registerSqliteStorage({ storage: undefined }))
		let thrown: unknown
		try {
			registeredSqliteStorage({ project: 'north' })
		} catch (error) {
			thrown = error
		}
		const error = toDialecteError(thrown)
		expect(error?.meta).toMatchObject({ project: 'north' })
		expect(error?.detail).toContain("import '@dialecte/core/sqlite'")
		expect(error?.detail).toContain('another copy of @dialecte/core')
	})
})
