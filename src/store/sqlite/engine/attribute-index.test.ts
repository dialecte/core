import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { attributeIndexTablesOf } from './attribute-index'
import {
	indexRowsOf,
	indexTablesHeldOf,
	pairStatesOf,
	seqOf,
	untilPairsReady,
} from './attribute-index.fixtures'
import { TABLE_HISTORY_ROWS_PREFIX } from './engine.constants'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { SqliteEngine } from './engine.types'
import type { AttributeLookup } from '@/store/store.types'
import type { AnyAttribute, AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** An engine on a file of its own holding the document with these records, its connection beside it. */
async function engineHolding(params: {
	records: AnyRawRecord[]
}): Promise<{ engine: SqliteEngine; db: Database; seq: number }> {
	const db = (await openMemoryFile({ opened })).connect()
	const engine = await startEngine({ db })
	await engine.registerDocument(makeDocument())
	await engine.bulkWrite(DOCUMENT_ID, { creates: params.records })
	return { engine, db, seq: seqOf({ db, documentId: DOCUMENT_ID }) }
}

/** A record of tag `A` (unless another is named) holding these attributes. */
function recordWith(id: string, attributes: AnyAttribute[], tagName = 'A'): AnyRawRecord {
	return makeRecord({ id, tagName, attributes })
}

/** The ids the engine's attribute lookup answers on the document, for tag `A` unless another is named. */
async function idsOf(params: {
	engine: SqliteEngine
	attributes: AttributeLookup['attributes']
	tagName?: string
	documentId?: string
}): Promise<string[]> {
	const { engine, attributes, tagName = 'A', documentId = DOCUMENT_ID } = params
	const records = await engine.getByAttributes({ documentId, tagName, attributes })
	return records.map((record) => record.id)
}

const SEEDED: AnyRawRecord[] = [
	recordWith('x', [
		{ name: 'k', value: '1' },
		{ name: 'l', value: 'p' },
	]),
	recordWith('m', [{ name: 'k', value: '2' }]),
	recordWith('c', [{ name: 'k', value: '1' }]),
	recordWith('b', [{ name: 'k', value: '1' }], 'B'),
]

describe('the attribute index of a document', () => {
	it('the first lookup of a pair → built in the call, ready once it has answered; the next lookup read from the index', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		async function firstThenBuilt(): Promise<Record<string, unknown>> {
			const first = await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			const built = pairStatesOf({ db, seq })
			const exact = indexRowsOf({ db, seq })
			// the index's rows taken away: a lookup that still answers did not read the index
			db.exec(`DELETE FROM ${attributeIndexTablesOf({ seq }).rows}`)
			const fromIndex = await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			return { first, built, exact, fromIndex }
		}
		await expect(firstThenBuilt()).resolves.toEqual({
			first: ['c', 'x'],
			built: { 'A.k': 'ready' },
			exact: [
				['A', 'k', '1', 'c'],
				['A', 'k', '1', 'x'],
				['A', 'k', '2', 'm'],
			],
			fromIndex: [],
		})
	})

	it('two entries on pairs built and not built → the one not built built in the call, both ready once it has answered; the same records', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		const both: AttributeLookup['attributes'] = [
			{ name: 'k', values: ['1'] },
			{ name: 'l', values: ['p'] },
		]
		async function eachPhase(): Promise<Record<string, unknown>> {
			await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			const oneReady = await idsOf({ engine, attributes: both })
			const states = pairStatesOf({ db, seq })
			const bothReady = await idsOf({ engine, attributes: both })
			return { oneReady, bothReady, states }
		}
		await expect(eachPhase()).resolves.toEqual({
			oneReady: ['x'],
			bothReady: ['x'],
			states: { 'A.k': 'ready', 'A.l': 'ready' },
		})
	})

	it('a record holding two attributes of one name and value, another two values of one name → one index row per value, each record answered once', async () => {
		const foreign = { prefix: 'f', uri: 'urn:f' }
		const { engine, db, seq } = await engineHolding({
			records: [
				recordWith('same', [
					{ name: 'k', value: '1', namespace: foreign },
					{ name: 'k', value: '1' },
				]),
				recordWith('twice', [
					{ name: 'k', value: '1', namespace: foreign },
					{ name: 'k', value: '2' },
				]),
			],
		})
		async function builtThenLookedUp(): Promise<Record<string, unknown>> {
			await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			await untilPairsReady({ db, seq, pairs: 1 })
			return {
				rows: indexRowsOf({ db, seq }),
				answer: await idsOf({
					engine,
					attributes: [
						{ name: 'k', values: ['1', '2', '1'] },
						{ name: 'k', values: ['1'] },
					],
				}),
			}
		}
		await expect(builtThenLookedUp()).resolves.toEqual({
			rows: [
				['A', 'k', '1', 'same'],
				['A', 'k', '1', 'twice'],
				['A', 'k', '2', 'twice'],
			],
			answer: ['same', 'twice'],
		})
	})

	it('no entry, an entry with no value, a document not registered → nothing, no pair registered', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		async function lookUps(): Promise<Record<string, unknown>> {
			const answers = {
				noEntry: await idsOf({ engine, attributes: [] }),
				noValue: await idsOf({ engine, attributes: [{ name: 'k', values: [] }] }),
				absent: await idsOf({
					engine,
					documentId: 'absent',
					attributes: [{ name: 'k', values: ['1'] }],
				}),
			}
			// every background turn the lookups could have queued has run
			for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve))
			return { ...answers, states: pairStatesOf({ db, seq }) }
		}
		await expect(lookUps()).resolves.toEqual({
			noEntry: [],
			noValue: [],
			absent: [],
			states: {},
		})
	})

	it('index tables an older purge left behind, their table number taken by a new document → never read; the new document’s lookups exact, its pairs built again', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		async function reusedNumber(): Promise<Record<string, unknown>> {
			await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			await untilPairsReady({ db, seq, pairs: 1 })
			// an older core's removal: the record and history tables and the row go, the index tables stay
			db.exec(
				`DROP TABLE ${TABLE_RECORD_PREFIX}${seq}; DROP TABLE ${TABLE_HISTORY_ROWS_PREFIX}${seq}; ` +
					`DELETE FROM ${TABLE_DOCUMENTS} WHERE seq = ${seq}`,
			)
			await engine.registerDocument(makeDocument({ id: 'doc-2' }))
			await engine.bulkWrite('doc-2', {
				creates: [
					recordWith('n', [{ name: 'k', value: '1' }]),
					recordWith('o', [{ name: 'k', value: '2' }]),
				],
			})
			function lookUp(): Promise<string[]> {
				return idsOf({ engine, documentId: 'doc-2', attributes: [{ name: 'k', values: ['1'] }] })
			}
			const again = seqOf({ db, documentId: 'doc-2' })
			const first = await lookUp()
			await untilPairsReady({ db, seq: again, pairs: 1 })
			return {
				sameNumber: again === seq,
				first,
				built: await lookUp(),
				rows: indexRowsOf({ db, seq: again }),
			}
		}
		await expect(reusedNumber()).resolves.toEqual({
			sameNumber: true,
			first: ['n'],
			built: ['n'],
			rows: [
				['A', 'k', '1', 'n'],
				['A', 'k', '2', 'o'],
			],
		})
	})

	it('a record table whose index triggers are gone (made again by an older core) → its index tables never read, the lookups exact, the pair built again', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		async function withoutTriggers(): Promise<Record<string, unknown>> {
			await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			await untilPairsReady({ db, seq, pairs: 1 })
			const { triggers } = attributeIndexTablesOf({ seq })
			for (const trigger of ['beforeInsert', 'afterInsert', 'afterDelete', 'afterUpdate']) {
				db.exec(`DROP TRIGGER ${triggers}${trigger}`)
			}
			// written while nothing keeps the index: its rows say nothing of these
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [recordWith('n', [{ name: 'k', value: '1' }])],
				deletes: ['x'],
			})
			return { answer: await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] }) }
		}
		await expect(withoutTriggers()).resolves.toEqual({ answer: ['c', 'n'] })
	})

	it('the document removed after a pair was built → its index tables gone with it; registered again → no index, its lookups answer its own records', async () => {
		const { engine, db, seq } = await engineHolding({ records: SEEDED })
		async function removedThenAgain(): Promise<Record<string, unknown>> {
			await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] })
			await untilPairsReady({ db, seq, pairs: 1 })
			await engine.removeDocument(DOCUMENT_ID)
			const afterRemoval = indexTablesHeldOf({ db, seq })
			await engine.registerDocument(makeDocument())
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [recordWith('n', [{ name: 'k', value: '1' }])],
			})
			const again = seqOf({ db, documentId: DOCUMENT_ID })
			return {
				afterRemoval,
				heldAgain: indexTablesHeldOf({ db, seq: again }),
				answer: await idsOf({ engine, attributes: [{ name: 'k', values: ['1'] }] }),
			}
		}
		await expect(removedThenAgain()).resolves.toEqual({
			afterRemoval: [],
			heldAgain: [],
			answer: ['n'],
		})
	})
})
