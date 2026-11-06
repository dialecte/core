import { ERROR_CATALOG } from './codes.constants'
import { RETIRED_SQLITE_ERROR_KEY, SQLITE_DECLARED_ERROR_CODES } from './errors.fixtures'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

/** The catalogue, read by any key: the keys of this file are new or gone, so the catalogue's own type does not know them. */
const CATALOGUE: Record<
	string,
	{ code: string; message: string; explanation?: { when: string; fix: string } } | undefined
> = ERROR_CATALOG

describe('ERROR_CATALOG — the new generic keys', () => {
	type TestCase = BaseTestCase & { key: string; code: string }

	const testCases: Record<string, TestCase> = {
		'STORE_CONNECTION_LOST → D1018, the code STORE_ENGINE_LOST had': {
			key: 'STORE_CONNECTION_LOST',
			code: 'D1018',
		},
		'STORE_KIND_TAKEN → D1021': { key: 'STORE_KIND_TAKEN', code: 'D1021' },
		'PROJECT_STORAGE_NOT_REGISTERED → D7018': {
			key: 'PROJECT_STORAGE_NOT_REGISTERED',
			code: 'D7018',
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		expect(CATALOGUE[testCase.key]?.code).toBe(testCase.code)
	})
})

describe('ERROR_CATALOG — what only SQLite storage raises, or a store of another kind never would', () => {
	type TestCase = BaseTestCase & { key: string }

	const testCases: Record<string, TestCase> = {
		...Object.fromEntries(
			Object.keys(SQLITE_DECLARED_ERROR_CODES).map((key) => [
				`${key} → declared by the SQLite side, not by core's catalogue`,
				{ key },
			]),
		),
		'STORE_ENGINE_LOST → gone: STORE_CONNECTION_LOST took its place': { key: 'STORE_ENGINE_LOST' },
		'PROJECT_SQLITE_NOT_IMPORTED → gone: PROJECT_STORAGE_NOT_REGISTERED took its place': {
			key: RETIRED_SQLITE_ERROR_KEY,
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		expect(Object.hasOwn(ERROR_CATALOG, testCase.key)).toBe(false)
	})
})

describe('ERROR_CATALOG — the texts of the errors any store raises name no store', () => {
	type TestCase = BaseTestCase & { key: string; forbidden: RegExp }

	/** What a generic text may not say: a store of its own (SQLite, its hub, its file system). */
	const NO_STORE = /sqlite|\bhub\b|opfs/i
	/** The lost connection says nothing of an engine either: it is the store's connection. */
	const NO_STORE_NO_ENGINE = /sqlite|\bhub\b|opfs|\bengine/i

	const testCases: Record<string, TestCase> = {
		'STORE_CONNECTION_LOST → the store’s connection, no engine and no hub': {
			key: 'STORE_CONNECTION_LOST',
			forbidden: NO_STORE_NO_ENGINE,
		},
		'STORE_CONNECTION_FAILED → no store named': {
			key: 'STORE_CONNECTION_FAILED',
			forbidden: NO_STORE,
		},
		'STORE_READ_FAILED → no store named': { key: 'STORE_READ_FAILED', forbidden: NO_STORE },
		'STORE_UNAVAILABLE → no store named': { key: 'STORE_UNAVAILABLE', forbidden: NO_STORE },
		'STORE_QUOTA_EXCEEDED → no store named': { key: 'STORE_QUOTA_EXCEEDED', forbidden: NO_STORE },
		'PROJECT_DIALECTE_MISMATCH → no store named': {
			key: 'PROJECT_DIALECTE_MISMATCH',
			forbidden: NO_STORE_NO_ENGINE,
		},
		'PROJECT_NAME_INVALID → no store named': { key: 'PROJECT_NAME_INVALID', forbidden: NO_STORE },
		'PROJECT_DIALECTE_VERSION_MISMATCH → no engine named': {
			key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
			forbidden: NO_STORE_NO_ENGINE,
		},
		'STORE_KIND_TAKEN → no store named': {
			key: 'STORE_KIND_TAKEN',
			forbidden: NO_STORE_NO_ENGINE,
		},
		'PROJECT_STORAGE_NOT_REGISTERED → no store named': {
			key: 'PROJECT_STORAGE_NOT_REGISTERED',
			forbidden: NO_STORE_NO_ENGINE,
		},
		'PROJECT_DESTROYED_WHILE_AWAY → no engine named': {
			key: 'PROJECT_DESTROYED_WHILE_AWAY',
			forbidden: NO_STORE_NO_ENGINE,
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const entry = CATALOGUE[testCase.key]
		const text = [entry?.message, entry?.explanation?.when, entry?.explanation?.fix].join('\n')
		expect({
			declared: entry !== undefined,
			named: text.match(new RegExp(testCase.forbidden.source, 'gi')) ?? [],
		}).toEqual({ declared: true, named: [] })
	})
})
