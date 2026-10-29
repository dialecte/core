import {
	CONTRACT_LONE_SURROGATE_TEXT,
	CONTRACT_REPLACED_TEXT,
} from '../contract/store-contract.constants'
import { expectRejectsWith } from '../contract/store-contract.fixtures'
import { openSqliteEngine } from './engine/sqlite-engine'
import { loadSqlite } from './load-sqlite'
import { installLosslessText, isLosslessTextInstalled } from './sqlite-text'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteTextCase } from './sqlite.types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** A database in memory of this realm's SQLite. */
async function memoryDatabase(): Promise<Database> {
	const sqlite3 = await loadSqlite()
	const db = new sqlite3.oo1.DB(':memory:', 'c')
	opened.push(db)
	return db
}

describe('SQLite text as this realm loads it', () => {
	const cases: Record<string, SqliteTextCase> = {
		'a text beginning with a byte order mark → read back with it': {
			sql: 'SELECT ?',
			bind: ['\u{FEFF}a'],
			expected: '\u{FEFF}a',
		},
		'a key holding a lone surrogate and the same key holding U+FFFD there → not equal': {
			sql: 'SELECT ? = ?',
			bind: [CONTRACT_LONE_SURROGATE_TEXT, CONTRACT_REPLACED_TEXT],
			expected: 0,
		},
		'a lone surrogate → bound as its own three bytes (WTF-8)': {
			sql: 'SELECT hex(CAST(? AS BLOB))',
			bind: [CONTRACT_LONE_SURROGATE_TEXT],
			expected: '78EDA08079',
		},
		'a lone surrogate before a surrogate pair, bound and read by SQLite from JSON → the same bytes':
			{
				sql: 'SELECT ? = (SELECT value FROM json_each(?))',
				bind: ['\uD800\u{10000}', JSON.stringify(['\uD800\u{10000}'])],
				expected: 1,
			},
		'a lone low surrogate → bound as its own three bytes': {
			sql: 'SELECT hex(CAST(? AS BLOB))',
			bind: ['\uDC00'],
			expected: 'EDB080',
		},
		'a pair written low half first → bound as two lone surrogates, three bytes each': {
			sql: 'SELECT hex(CAST(? AS BLOB))',
			bind: ['\uDC00\uD800'],
			expected: 'EDB080EDA080',
		},
		'a well-formed text with a surrogate pair → bound as UTF-8': {
			sql: 'SELECT hex(CAST(? AS BLOB))',
			bind: ['\u{1D11E}'],
			expected: 'F09D849E',
		},
	}

	for (const [description, { sql, bind, expected }] of Object.entries(cases)) {
		it(description, async () => {
			const db = await memoryDatabase()
			expect(db.selectValue(sql, bind as never)).toBe(expected)
		})
	}

	it('installed again → one install, the same members', async () => {
		const sqlite3 = await loadSqlite()
		const { allocCString, typedArrayToString } = sqlite3.wasm as unknown as Record<string, unknown>
		installLosslessText({ sqlite3 })
		expect(isLosslessTextInstalled({ sqlite3 })).toBe(true)
		const after = sqlite3.wasm as unknown as Record<string, unknown>
		expect(after.allocCString).toBe(allocCString)
		expect(after.typedArrayToString).toBe(typedArrayToString)
	})

	it('a SQLite without the members the install replaces → ASSERTION_FAILED', async () => {
		const sqlite3 = await loadSqlite()
		const lacking = { ...sqlite3, wasm: {} } as unknown as Sqlite3Static
		await expectRejectsWith({
			action: Promise.resolve().then(function install() {
				installLosslessText({ sqlite3: lacking })
			}),
			key: 'ASSERTION_FAILED',
			detail: /typedArrayToString/,
		})
	})

	it('an engine opened on a SQLite module the install never saw → ASSERTION_FAILED', async () => {
		const sqlite3 = await loadSqlite()
		const unseen = { ...sqlite3, wasm: { ...sqlite3.wasm } } as Sqlite3Static
		const db = await memoryDatabase()
		await expectRejectsWith({
			action: Promise.resolve().then(function open() {
				return openSqliteEngine({ sqlite3: unseen, db, dialecteId: 'test', name: 'unseen' })
			}),
			key: 'ASSERTION_FAILED',
			detail: /text codec/,
		})
	})
})
