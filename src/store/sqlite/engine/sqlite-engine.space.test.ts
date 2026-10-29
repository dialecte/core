import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import { IMPORT_SPACE_FLOOR_BYTES } from './engine.constants'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** Pages the file may still grow by once a case caps it: room for a few records, not for many. */
const PAGES_LEFT = 16

/** An engine on a file of its own, the file then capped `PAGES_LEFT` pages above its size. */
async function startCappedEngine(): Promise<{ engine: SqliteEngine; cap: () => void }> {
	const file = await openMemoryFile({ opened })
	const db = file.connect()
	const engine = await startEngine({ db, runtime: createContractRuntime() })
	return {
		engine,
		cap: function capFile() {
			const pages = Number(db.selectValue('PRAGMA page_count'))
			db.exec(`PRAGMA max_page_count = ${pages + PAGES_LEFT}`)
		},
	}
}

function manyElements(params: { count: number }): string {
	return Array.from({ length: params.count }, (_, index) => `<A aA="${index}"/>`).join('')
}

describe('an import whose space is being checked', () => {
	it('its outcome asked meanwhile → running (no row yet, yet it will apply), then applied', async () => {
		const file = await openMemoryFile({ opened })
		const checking = Promise.withResolvers<void>()
		const engine = await startEngine({
			db: file.connect(),
			runtime: createContractRuntime(),
			ensureImportSpace: () => checking.promise,
		})
		const importing = engine.importFile({
			file: contractFile({ body: '<A aA="1"/>' }),
			writeId: 'w-1',
			clientId: 'c-1',
		})
		// the import has its turn and awaits its check
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(await engine.getWriteOutcome({ writeId: 'w-1' })).toBe('running')
		checking.resolve()
		await importing
		expect(await engine.getWriteOutcome({ writeId: 'w-1' })).toBe('applied')
	})
})

describe('an engine whose file can grow no more', () => {
	it('an import outgrowing it → STORE_QUOTA_EXCEEDED naming the project, nothing registered', async () => {
		const { engine, cap } = await startCappedEngine()
		cap()
		await expectRejectsWith({
			action: engine.importFile({
				file: contractFile({ body: manyElements({ count: 5_000 }) }),
				writeId: 'w-1',
				clientId: 'c-1',
			}),
			key: 'STORE_QUOTA_EXCEEDED',
			meta: { project: 'engine-test' },
		})
		expect(await engine.getDocuments()).toEqual([])
	})

	it('a commit outgrowing it → STORE_QUOTA_EXCEEDED naming the project, nothing of it applied', async () => {
		const { engine, cap } = await startCappedEngine()
		await engine.registerDocument(makeDocument())
		cap()
		await expectRejectsWith({
			action: engine.commit({
				documentId: 'doc-1',
				writeId: 'w-1',
				creates: Array.from({ length: 5_000 }, (_, index) => makeRecord({ id: `r${index}` })),
				updates: [],
				deletes: [],
			}),
			key: 'STORE_QUOTA_EXCEEDED',
			meta: { project: 'engine-test' },
		})
		expect(await engine.count('doc-1')).toBe(0)
	})
})

describe('the space an import asks for', () => {
	/** An engine whose space check records what it is asked, and the bytes its file has free. */
	async function startAskedEngine(): Promise<{
		engine: SqliteEngine
		asked: number[]
		freeBytes: () => number
	}> {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const asked: number[] = []
		const engine = await startEngine({
			db,
			runtime: createContractRuntime(),
			ensureImportSpace: async function recordAsked({ bytes }) {
				asked.push(bytes)
			},
		})
		return {
			engine,
			asked,
			freeBytes: function freeBytesOf() {
				return (
					Number(db.selectValue('PRAGMA freelist_count')) *
					Number(db.selectValue('PRAGMA page_size'))
				)
			},
		}
	}

	/** Free pages in the file: a commit deleting `count` records leaves their pages free. */
	async function freePagesOf(params: { engine: SqliteEngine; count: number }): Promise<void> {
		const { engine, count } = params
		const ids = Array.from({ length: count }, (_, index) => `r${index}`)
		await engine.registerDocument(makeDocument())
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-fill',
			creates: ids.map((id) => makeRecord({ id, value: 'x'.repeat(200) })),
			updates: [],
			deletes: [],
		})
		await engine.commit({
			documentId: 'doc-1',
			writeId: 'w-empty',
			creates: [],
			updates: [],
			deletes: ids,
		})
	}

	/** What the measurements set (a project file up to 7.5 times its XML), stated here, not read from the engine. */
	const MEASURED_FACTOR = 8

	type TestCase = {
		elements: number
		freedRecords: number
		expected: (params: { size: number; free: number }) => number
	}
	const testCases: Record<string, TestCase> = {
		'a file of about 300 KB, no page free → eight times its size': {
			elements: 15_000,
			freedRecords: 0,
			expected: ({ size }) => MEASURED_FACTOR * size,
		},
		'a file of a few bytes → the floor a new document needs, not eight times its size': {
			elements: 1,
			freedRecords: 0,
			expected: () => IMPORT_SPACE_FLOOR_BYTES,
		},
		'free pages covering part of it → eight times its size less the free bytes': {
			elements: 15_000,
			freedRecords: 2_000,
			expected: ({ size, free }) => MEASURED_FACTOR * size - free,
		},
		'free pages covering all of it → nothing asked': {
			elements: 300,
			freedRecords: 20_000,
			expected: () => 0,
		},
	}
	for (const [description, { elements, freedRecords, expected }] of Object.entries(testCases)) {
		it(description, async () => {
			const { engine, asked, freeBytes } = await startAskedEngine()
			if (freedRecords > 0) await freePagesOf({ engine, count: freedRecords })
			const file = contractFile({ body: manyElements({ count: elements }) })
			const free = freeBytes()
			if (freedRecords > 0) expect(free).toBeGreaterThan(0)
			await engine.importFile({ file, writeId: 'w-asked', clientId: 'c-1' })
			expect(asked).toEqual([Math.max(0, expected({ size: file.size, free }))])
		})
	}
})
