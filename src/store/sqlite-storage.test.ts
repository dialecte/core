import {
	registeredSqliteStorage,
	registerSqliteStorage,
	replaceSqliteStorage,
} from './sqlite-storage'
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
		/** The kind in place before the case (as a case replaces it), then what the case registers, in order. */
		before?: SqliteStorage
		registers: SqliteStorage[]
		/** A copy of the library of the same storage version registered it (on `globalThis`, not through this module). */
		byAnotherCopy?: SqliteStorage
		expected: SqliteStorage | string
	}
	const testCases: Record<string, TestCase> = {
		'none registered → PROJECT_SQLITE_NOT_IMPORTED': {
			registers: [],
			expected: 'PROJECT_SQLITE_NOT_IMPORTED',
		},
		'registered → that kind': { registers: [first], expected: first },
		'registered twice (two copies of the same storage version imported the entry) → the first kept: one copy runs the realm’s engines':
			{ registers: [first, second], expected: first },
		'one registered already, the entry imported again → the one registered already': {
			before: first,
			registers: [second],
			expected: first,
		},
		'registered by another copy of the library of the same storage version → that kind': {
			registers: [],
			byAnotherCopy: first,
			expected: first,
		},
	}
	for (const [description, { before, registers, byAnotherCopy, expected }] of Object.entries(
		testCases,
	)) {
		it(description, () => {
			onTestFinished(replaceSqliteStorage({ storage: before }))
			for (const registered of registers) registerSqliteStorage({ storage: registered })
			if (byAnotherCopy) (globalThis as SqliteStorageHolder)[SQLITE_STORAGE_KEY] = byAnotherCopy
			expect(answerOf()).toBe(expected)
		})
	}

	it('replaced for a case, then restored → the kind registered before it, or none', () => {
		onTestFinished(replaceSqliteStorage({ storage: undefined }))
		registerSqliteStorage({ storage: first })
		const restore = replaceSqliteStorage({ storage: second })
		expect(answerOf()).toBe(second)
		restore()
		expect(answerOf()).toBe(first)
	})

	it('refused → its meta names the project, its detail the import to add and the other-copy cause', () => {
		onTestFinished(replaceSqliteStorage({ storage: undefined }))
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
