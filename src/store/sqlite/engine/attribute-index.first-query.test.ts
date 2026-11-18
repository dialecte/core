import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import {
	attributeIndexTablesOf,
	readFilteredRecords,
	registerAttributePair,
} from './attribute-index'
import { indexRowsOf, pairStatesOf, recomputedIndexRowsOf, seqOf } from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

/** Lookups of the burst, made back to back as an edit right after an import makes them. */
const BURST = 50

/** The filter's statement reads the tag's records as `r` (`readFilteredRecords`): what a lookup not served by the index runs. */
const FILTER_SQL = 'r WHERE r.tagName = ?'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	vi.restoreAllMocks()
	for (const db of opened.splice(0)) db.close()
})

/** 5,000 records of A, `r0000`..`r4999`, each holding k = its number modulo 7. */
const MANY = Array.from({ length: 5_000 }, (_, index) =>
	makeRecord({
		id: `r${String(index).padStart(4, '0')}`,
		tagName: 'A',
		attributes: [{ name: 'k', value: String(index % 7) }],
	}),
)

/** An engine on a file of its own holding the 5,000 records, its connection beside it. */
async function engineHoldingMany(): Promise<{ engine: SqliteEngine; db: Database; seq: number }> {
	const db = (await openMemoryFile({ opened })).connect()
	const engine = await startEngine({ db })
	await engine.registerDocument(makeDocument())
	await engine.bulkWrite(DOCUMENT_ID, { creates: MANY })
	return { engine, db, seq: seqOf({ db, documentId: DOCUMENT_ID }) }
}

/** The ids of A holding one of these k values the engine answers. */
async function holdersOf(params: { engine: SqliteEngine; values: string[] }): Promise<string[]> {
	const { engine, values } = params
	const records = await engine.getByAttributes({
		documentId: DOCUMENT_ID,
		tagName: 'A',
		attributes: [{ name: 'k', values }],
	})
	return records.map((record) => record.id)
}

/** The ids the SQL filter answers for the same lookup on the connection. */
function filteredIdsOf(params: { db: Database; seq: number; values: string[] }): string[] {
	const { db, seq, values } = params
	return readFilteredRecords({
		db,
		table: attributeIndexTablesOf({ seq }).records,
		tagName: 'A',
		attributes: [{ name: 'k', values }],
	}).map((record) => record.id)
}

describe('the first lookup of a pair builds it in the call', () => {
	it(`${BURST} lookups of one pair right after a write → the pair ready once the first has answered, no filter run, every answer the filter's, the index exact`, async () => {
		const { engine, db, seq } = await engineHoldingMany()
		async function burst(): Promise<Record<string, unknown>> {
			const selects = vi.spyOn(db, 'selectArrays')
			const answers: string[][] = []
			let afterFirst: Record<string, string> = {}
			for (let lookup = 0; lookup < BURST; lookup += 1) {
				answers.push(await holdersOf({ engine, values: [String(lookup % 7)] }))
				if (lookup === 0) afterFirst = pairStatesOf({ db, seq })
			}
			const filterRuns = selects.mock.calls.filter(([sql]) => String(sql).includes(FILTER_SQL))
			selects.mockRestore()
			const expected = Array.from({ length: BURST }, (_, lookup) =>
				filteredIdsOf({ db, seq, values: [String(lookup % 7)] }),
			)
			return {
				afterFirst,
				filterRuns: filterRuns.length,
				sameAnswers: JSON.stringify(answers) === JSON.stringify(expected),
				exact:
					JSON.stringify(indexRowsOf({ db, seq })) ===
					JSON.stringify(recomputedIndexRowsOf({ db, seq })),
			}
		}
		await expect(burst()).resolves.toEqual({
			afterFirst: { 'A.k': 'ready' },
			filterRuns: 0,
			sameAnswers: true,
			exact: true,
		})
	})

	it('a pair an earlier engine left building → finished in its first lookup, answered from the index, exact', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		// what an engine stopped between two slices of its background build leaves: registered, no row yet
		db.exec('BEGIN IMMEDIATE')
		registerAttributePair({ db, tables: attributeIndexTablesOf({ seq }), tagName: 'A', name: 'k' })
		db.exec('COMMIT')
		engine.close()
		const nextDb = file.connect()
		const next = await startEngine({ db: nextDb })
		async function finished(): Promise<Record<string, unknown>> {
			const left = pairStatesOf({ db: nextDb, seq })
			const answered = await holdersOf({ engine: next, values: ['3'] })
			return {
				left,
				afterLookup: pairStatesOf({ db: nextDb, seq }),
				answered: answered.length,
				sameAnswer:
					JSON.stringify(answered) ===
					JSON.stringify(filteredIdsOf({ db: nextDb, seq, values: ['3'] })),
				exact:
					JSON.stringify(indexRowsOf({ db: nextDb, seq })) ===
					JSON.stringify(recomputedIndexRowsOf({ db: nextDb, seq })),
			}
		}
		// 714 of the 5,000 hold 3 (index % 7)
		await expect(finished()).resolves.toEqual({
			left: { 'A.k': 'building' },
			afterLookup: { 'A.k': 'ready' },
			answered: 714,
			sameAnswer: true,
			exact: true,
		})
	})
})
