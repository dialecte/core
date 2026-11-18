import { deletedRef, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import {
	indexRowsOf,
	recomputedIndexRowsOf,
	seqOf,
	untilPairsReady,
} from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { SqliteEngine } from './engine.types'
import type { ChangedRecord } from '@/project/types'
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
	deletes?: ReadonlyArray<ChangedRecord>
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
	deletes: [deletedRef('c')],
})

/** Records with odd attributes: a value twice, an empty value, a foreign homonym, a very long value, no attribute. */
const ODD: AnyRawRecord[] = [
	recordWith('o1', [
		{ name: 'k', value: '1' },
		{ name: 'k', value: '1' },
	]),
	recordWith('o2', [{ name: 'k', value: '' }]),
	recordWith('o3', [{ name: 'k', value: '1', namespace: { prefix: 'f', uri: 'urn:f' } }]),
	recordWith('o4', [{ name: 'k', value: 'v'.repeat(10_000) }]),
	recordWith('o5', []),
]

/** A commit creating the odd records and giving `m` a foreign homonym holding k="1". */
const ODD_COMMITTED = commitOf({
	creates: ODD,
	updates: [recordWith('m', [{ name: 'k', value: '1', namespace: { prefix: 'f', uri: 'urn:f' } }])],
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
			await engine.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
		},
		expected: { A: ['c', 'x'], B: ['b'] },
	},
	'a commit, its undo, then its redo': {
		writes: async (engine) => {
			await COMMITTED(engine)
			await engine.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			await engine.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
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
	'a commit of records with odd attributes': {
		writes: ODD_COMMITTED,
		expected: { A: ['c', 'm', 'o1', 'o3', 'x'], B: ['b'] },
	},
	'a commit of records with odd attributes, then its undo': {
		writes: async (engine) => {
			await ODD_COMMITTED(engine)
			await engine.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
		},
		expected: { A: ['c', 'x'], B: ['b'] },
	},
	'a commit of records with odd attributes, its undo, then its redo': {
		writes: async (engine) => {
			await ODD_COMMITTED(engine)
			await engine.undo({ documentId: DOCUMENT_ID, changeId: 'undo-1' })
			await engine.redo({ documentId: DOCUMENT_ID, changeId: 'redo-1' })
		},
		expected: { A: ['c', 'm', 'o1', 'o3', 'x'], B: ['b'] },
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

// an import writes into a record table of its own, made fresh: no index trigger fires there, so it is no write path here

/**
 * Raw writes of a connection that registers nothing (an older core, a tool): rows whose attributes are not JSON,
 * JSON `null`, a list of non-objects, objects without a name or with a `null`, number or boolean value; a replace,
 * updates of the attributes and of the tag, deletes. The record table is `rec`.
 */
function plainWritesOf(params: { rec: string }): string {
	const { rec } = params
	const columns =
		'id, tagName, nsPrefix, nsUri, value, parentId, parentTagName, attributes, children'
	return [
		`INSERT INTO ${rec} (id, tagName, attributes) VALUES ('p1', 'A', 'not json'), ('p2', 'A', 'null'), ('p3', 'A', '["k", 1, null]')`,
		`INSERT INTO ${rec} (id, tagName, attributes) VALUES ('p4', 'A', '[{"value":"1"},{"name":"k","value":null},{"name":"k","value":7},{"name":"k","value":false},{"name":"k"}]')`,
		`INSERT OR REPLACE INTO ${rec} (${columns}) SELECT id, tagName, nsPrefix, nsUri, value, parentId, parentTagName, ` +
			`'[{"name":"k","value":"2"}]', children FROM ${rec} WHERE id = 'c'`,
		`UPDATE ${rec} SET attributes = '[{"name":"k","value":"5"}]' WHERE id = 'x'`,
		`UPDATE ${rec} SET tagName = 'B' WHERE id = 'm'`,
		`UPDATE ${rec} SET tagName = 'A' WHERE id = 'z'`,
		`UPDATE ${rec} SET attributes = 'still not json' WHERE id = 'p1'`,
		`DELETE FROM ${rec} WHERE id IN ('b', 'p2')`,
	].join(';')
}

describe('the attribute index and a connection that registers nothing', () => {
	it('odd raw rows inserted, replaced, updated and deleted → every write lands, the index holds what its SQL rules give, the next engine answers from it', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: SEEDED })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function writtenPlainly(): Promise<Record<string, unknown>> {
			for (const tagName of ['A', 'B']) {
				await engine.getByAttributes({
					documentId: DOCUMENT_ID,
					tagName,
					attributes: [{ name: 'k', values: ['1'] }],
				})
			}
			await untilPairsReady({ db, seq, pairs: 2 })
			engine.close()
			const plain = file.connect()
			plain.exec(plainWritesOf({ rec: `${TABLE_RECORD_PREFIX}${seq}` }))
			const nextDb = file.connect()
			const next = await startEngine({ db: nextDb })
			async function holders(tagName: string, value: string): Promise<string[]> {
				const records = await next.getByAttributes({
					documentId: DOCUMENT_ID,
					tagName,
					attributes: [{ name: 'k', values: [value] }],
				})
				return records.map((record) => record.id)
			}
			return {
				rows: indexRowsOf({ db: nextDb, seq }),
				A1: await holders('A', '1'),
				A2: await holders('A', '2'),
				B2: await holders('B', '2'),
			}
		}
		// numbers and booleans become text (false -> '0'); a value null or absent, a nameless item, a non-object, an
		// attributes text that is not JSON give no row
		await expect(writtenPlainly()).resolves.toEqual({
			rows: [
				['A', 'k', '0', 'p4'],
				['A', 'k', '1', 'z'],
				['A', 'k', '2', 'c'],
				['A', 'k', '5', 'x'],
				['A', 'k', '7', 'p4'],
				['B', 'k', '2', 'm'],
			],
			A1: ['z'],
			A2: ['c'],
			B2: ['m'],
		})
	})
})
