import { registerSqliteEngine, registeredSqliteEngine } from './sqlite-engine-registration'

import { describe, expect, it, onTestFinished } from 'vitest'

import { createCountingDialecte } from '@/dialecte/create-project-factory.fixtures'
import { toDialecteError } from '@/errors'
import { replaceSqliteStorage } from '@/store/sqlite/sqlite-storage'
import { SQLITE_STORAGE_KEY } from '@/store/sqlite/sqlite-storage.constants'

import type {
	SqliteEngineRegistration,
	SqliteStorage,
	SqliteStorageHolder,
} from '@/store/sqlite/sqlite-storage.types'

const URL_A = 'https://dialecte.test/assets/engine-a.worker.js'
const URL_B = 'https://dialecte.test/assets/engine-b.worker.js'

const NORTH = { id: 'north/dialecte', version: '1.0.0' }
const SOUTH = { id: 'south/dialecte', version: '2.0.0' }
const NORTH_NEXT = { id: NORTH.id, version: '1.1.0' }

/** A kind with no engine registered on it, in place for the case; the one before is put back after it. */
function withBareKind(): SqliteStorage {
	const kind: SqliteStorage = {
		storeOf: function notBuilt() {
			throw new Error('not built in this case')
		},
	}
	onTestFinished(replaceSqliteStorage({ storage: kind }))
	return kind
}

/** What a registration answered: `registered` (it returned), or the key it was refused with. */
function outcomeOf(params: { call: () => void }): string {
	try {
		params.call()
		return 'registered'
	} catch (thrown) {
		return toDialecteError(thrown)?.key ?? `threw ${String(thrown)}`
	}
}

/** The error a registration was refused with. */
function refusalOf(params: { call: () => void }): ReturnType<typeof toDialecteError> {
	try {
		params.call()
		return undefined
	} catch (thrown) {
		return toDialecteError(thrown)
	}
}

describe('registering the SQLite engine of an app', () => {
	type Registration = { url: string; dialectes: readonly { id: string; version: string }[] }
	type TestCase = {
		/** The registrations of the case, in order. */
		registers: Registration[]
		/** What each answered: `registered`, or the key it was refused with. */
		outcomes: string[]
		/** The registration found afterwards. */
		kept: Registration | undefined
	}
	const FIRST: Registration = { url: URL_A, dialectes: [NORTH, SOUTH] }
	const testCases: Record<string, TestCase> = {
		'one registration → found as given: the address and the id and version of each dialecte': {
			registers: [FIRST],
			outcomes: ['registered'],
			kept: FIRST,
		},
		'the same address and the same dialectes again → nothing happens, the first kept (a module evaluated twice)':
			{
				registers: [FIRST, { url: URL_A, dialectes: [NORTH, SOUTH] }],
				outcomes: ['registered', 'registered'],
				kept: FIRST,
			},
		'the same address and the same dialectes in another order → nothing happens, the first kept': {
			registers: [FIRST, { url: URL_A, dialectes: [SOUTH, NORTH] }],
			outcomes: ['registered', 'registered'],
			kept: FIRST,
		},
		'another address → STORE_SQLITE_ENGINE_FIXED, the first kept': {
			registers: [FIRST, { url: URL_B, dialectes: [NORTH, SOUTH] }],
			outcomes: ['registered', 'STORE_SQLITE_ENGINE_FIXED'],
			kept: FIRST,
		},
		'one more dialecte → STORE_SQLITE_ENGINE_FIXED, the first kept: there is no additive call': {
			registers: [
				FIRST,
				{ url: URL_A, dialectes: [NORTH, SOUTH, { id: 'east/dialecte', version: '3.0.0' }] },
			],
			outcomes: ['registered', 'STORE_SQLITE_ENGINE_FIXED'],
			kept: FIRST,
		},
		'one dialecte fewer → STORE_SQLITE_ENGINE_FIXED, the first kept': {
			registers: [FIRST, { url: URL_A, dialectes: [NORTH] }],
			outcomes: ['registered', 'STORE_SQLITE_ENGINE_FIXED'],
			kept: FIRST,
		},
		'another version of a dialecte → STORE_SQLITE_ENGINE_FIXED, the first kept': {
			registers: [FIRST, { url: URL_A, dialectes: [NORTH_NEXT, SOUTH] }],
			outcomes: ['registered', 'STORE_SQLITE_ENGINE_FIXED'],
			kept: FIRST,
		},
		'two versions of one dialecte in one call → STORE_HUB_SPAWNERS_FIXED, nothing kept': {
			registers: [{ url: URL_A, dialectes: [NORTH, NORTH_NEXT] }],
			outcomes: ['STORE_HUB_SPAWNERS_FIXED'],
			kept: undefined,
		},
		'two versions of one dialecte in a second call → STORE_HUB_SPAWNERS_FIXED, the first kept': {
			registers: [FIRST, { url: URL_A, dialectes: [NORTH, NORTH_NEXT, SOUTH] }],
			outcomes: ['registered', 'STORE_HUB_SPAWNERS_FIXED'],
			kept: FIRST,
		},
	}
	for (const [description, { registers, outcomes, kept }] of Object.entries(testCases)) {
		it(description, () => {
			withBareKind()
			const answered = registers.map(function register(registration) {
				return outcomeOf({
					call: function registerIt() {
						registerSqliteEngine(registration)
					},
				})
			})
			expect(answered).toEqual(outcomes)
			expect(registeredSqliteEngine()).toEqual(kept)
		})
	}

	it('a registration → answers nothing', () => {
		withBareKind()
		expect(registerSqliteEngine({ url: URL_A, dialectes: [NORTH] })).toBeUndefined()
	})

	it('another address → the refusal names the registered engine and the asked one', () => {
		withBareKind()
		const refused = refusalOf({
			call: function registerThenElsewhere() {
				registerSqliteEngine({ url: URL_A, dialectes: [NORTH, SOUTH] })
				registerSqliteEngine({ url: URL_B, dialectes: [NORTH] })
			},
		})
		expect(refused).toMatchObject({
			key: 'STORE_SQLITE_ENGINE_FIXED',
			meta: {
				registered: { url: URL_A, dialectes: [NORTH, SOUTH] },
				asked: { url: URL_B, dialectes: [NORTH] },
			},
		})
	})

	it('full declarations handed in → only each id and version kept: no hook, no config on the realm', () => {
		const kind = withBareKind()
		const declared = createCountingDialecte()
		const outcome = outcomeOf({
			call: function registerFull() {
				registerSqliteEngine({ url: URL_A, dialectes: [declared] })
			},
		})
		expect(outcome).toBe('registered')
		const expected: SqliteEngineRegistration = {
			url: URL_A,
			dialectes: [{ id: declared.id, version: declared.version }],
		}
		expect(registeredSqliteEngine()).toStrictEqual(expected)
		expect(kind.engine).toStrictEqual(expected)
	})

	it('a registration the kind holds on the realm, written by another copy of the library → found: read through the kind on globalThis, not a module variable', () => {
		const written: SqliteEngineRegistration = { url: URL_B, dialectes: [SOUTH] }
		const kind: SqliteStorage = {
			storeOf: function notBuilt() {
				throw new Error('not built in this case')
			},
			engine: written,
		}
		onTestFinished(replaceSqliteStorage({ storage: undefined }))
		;(globalThis as SqliteStorageHolder)[SQLITE_STORAGE_KEY] = kind
		expect(registeredSqliteEngine()).toEqual(written)
	})

	it('a registration made through this copy → on the kind of the realm, where another copy reads it', () => {
		const kind = withBareKind()
		const outcome = outcomeOf({
			call: function registerHere() {
				registerSqliteEngine({ url: URL_A, dialectes: [NORTH] })
			},
		})
		expect(outcome).toBe('registered')
		expect((globalThis as SqliteStorageHolder)[SQLITE_STORAGE_KEY]).toBe(kind)
		expect(kind.engine).toEqual({ url: URL_A, dialectes: [NORTH] })
	})
})
