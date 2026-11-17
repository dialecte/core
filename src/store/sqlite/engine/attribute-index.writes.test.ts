import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import {
	indexRowsOf,
	recomputedIndexRowsOf,
	seqOf,
	untilPairsReady,
} from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { AnyAttribute, AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** A record of tag `A` (unless another is named) holding these attributes. */
function recordWith(id: string, attributes: AnyAttribute[], tagName = 'A'): AnyRawRecord {
	return makeRecord({ id, tagName, attributes })
}

/** `x`, `c` of A holding k="1", `m` of A k="2", `b` of B k="1", `z` of C k="1" (C has no pair). */
const SEEDED: AnyRawRecord[] = [
	recordWith('x', [{ name: 'k', value: '1' }]),
	recordWith('m', [{ name: 'k', value: '2' }]),
	recordWith('c', [{ name: 'k', value: '1' }]),
	recordWith('b', [{ name: 'k', value: '1' }], 'B'),
	recordWith('z', [{ name: 'k', value: '1' }], 'C'),
]

/** What a case writes once the pairs A.k and B.k are built. */
type Writes = (engine: SqliteEngine) => Promise<unknown>

type WriteCase = {
	writes: Writes
	/** The ids of A, then of B, holding k="1" after the writes. */
	expected: { A: string[]; B: string[] }
}

function commitOf(params: {
	creates?: AnyRawRecord[]
	updates?: AnyRawRecord[]
	deletes?: string[]
}): (engine: SqliteEngine) => Promise<void> {
	const { creates = [], updates = [], deletes = [] } = params
	return function commitWrites(engine) {
		return engine.commit({
			documentId: DOCUMENT_ID,
			writeId: crypto.randomUUID(),
			creates,
			updates,
			deletes,
		})
	}
}

const COMMITTED = commitOf({
	creates: [recordWith('n', [{ name: 'k', value: '1' }])],
	updates: [
		recordWith('m', [{ name: 'k', value: '1' }]),
		recordWith('x', [{ name: 'k', value: '3' }]),
	],
	deletes: ['c'],
})

const WRITE_CASES: Record<string, WriteCase> = {
	'a bulk write creating, patching the attributes and deleting': {
		writes: (engine) =>
			engine.bulkWrite(DOCUMENT_ID, {
				creates: [recordWith('a', [{ name: 'k', value: '1' }])],
				updates: [
					{ recordId: 'm', attributes: [{ name: 'k', value: '1' }] },
					{ recordId: 'x', attributes: [{ name: 'k', value: '3' }] },
				],
				deletes: ['c'],
			}),
		expected: { A: ['a', 'm'], B: ['b'] },
	},
	'a bulk-write patch moving records to another tag (one with a pair, one without), and one back': {
		writes: (engine) =>
			engine.bulkWrite(DOCUMENT_ID, {
				updates: [
					{ recordId: 'x', tagName: 'B' },
					{ recordId: 'c', tagName: 'C' },
					{ recordId: 'z', tagName: 'A' },
				],
			}),
		expected: { A: ['z'], B: ['b', 'x'] },
	},
	'a bulk-write patch leaving the attributes as they are (only the text value)': {
		writes: (engine) =>
			engine.bulkWrite(DOCUMENT_ID, { updates: [{ recordId: 'x', value: 'text' }] }),
		expected: { A: ['c', 'x'], B: ['b'] },
	},
	'a commit creating, updating and deleting': {
		writes: COMMITTED,
		expected: { A: ['m', 'n'], B: ['b'] },
	},
	'a commit, then its undo (records written back with INSERT OR REPLACE)': {
		writes: async (engine) => {
			await COMMITTED(engine)
			await engine.undo(DOCUMENT_ID)
		},
		expected: { A: ['c', 'x'], B: ['b'] },
	},
	'a commit, its undo, then its redo': {
		writes: async (engine) => {
			await COMMITTED(engine)
			await engine.undo(DOCUMENT_ID)
			await engine.redo(DOCUMENT_ID)
		},
		expected: { A: ['m', 'n'], B: ['b'] },
	},
	'records with odd attributes: a value twice, an empty value, a foreign homonym, a very long value, no attribute':
		{
			writes: (engine) =>
				engine.bulkWrite(DOCUMENT_ID, {
					creates: [
						recordWith('o1', [
							{ name: 'k', value: '1' },
							{ name: 'k', value: '1' },
						]),
						recordWith('o2', [{ name: 'k', value: '' }]),
						recordWith('o3', [{ name: 'k', value: '1', namespace: { prefix: 'f', uri: 'urn:f' } }]),
						recordWith('o4', [{ name: 'k', value: 'v'.repeat(10_000) }]),
						recordWith('o5', []),
					],
				}),
			expected: { A: ['c', 'o1', 'o3', 'x'], B: ['b'] },
		},
}

describe('the attribute index after each write path', () => {
	for (const [description, { writes, expected }] of Object.entries(WRITE_CASES)) {
		it(`${description} → the index equals its recomputation, the lookups follow`, async () => {
			const db = (await openMemoryFile({ opened })).connect()
			const engine = await startEngine({ db })
			await engine.registerDocument(makeDocument())
			await engine.bulkWrite(DOCUMENT_ID, { creates: SEEDED })
			const seq = seqOf({ db, documentId: DOCUMENT_ID })
			async function lookUp(tagName: string): Promise<string[]> {
				const records = await engine.getByAttributes({
					documentId: DOCUMENT_ID,
					tagName,
					attributes: [{ name: 'k', values: ['1'] }],
				})
				return records.map((record) => record.id)
			}
			async function builtThenWritten(): Promise<Record<string, unknown>> {
				await lookUp('A')
				await lookUp('B')
				await untilPairsReady({ db, seq, pairs: 2 })
				await writes(engine)
				const held = indexRowsOf({ db, seq }).map((row) => JSON.stringify(row))
				const recomputed = recomputedIndexRowsOf({ db, seq }).map((row) => JSON.stringify(row))
				return {
					rowsHeld: held.length > 0,
					missing: recomputed.filter((row) => !held.includes(row)),
					extra: held.filter((row) => !recomputed.includes(row)),
					A: await lookUp('A'),
					B: await lookUp('B'),
				}
			}
			await expect(builtThenWritten()).resolves.toEqual({
				rowsHeld: true,
				missing: [],
				extra: [],
				...expected,
			})
		})
	}
})
