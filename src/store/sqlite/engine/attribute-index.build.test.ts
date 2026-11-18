import { contractFile, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import {
	indexRowsOf,
	pairStatesOf,
	recomputedIndexRowsOf,
	seqOf,
	untilPairsReady,
} from './attribute-index.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

const DOCUMENT_ID = 'doc-1'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []
/** Holds a case left waiting, let go after it. */
const holds: (() => void)[] = []

afterEach(() => {
	for (const release of holds.splice(0)) release()
	for (const db of opened.splice(0)) db.close()
})

/** 5,000 records of A, `r0000`..`r4999`, each holding k = its number modulo 7: three build slices. */
const MANY = Array.from({ length: 5_000 }, (_, index) =>
	makeRecord({
		id: `r${String(index).padStart(4, '0')}`,
		tagName: 'A',
		attributes: [{ name: 'k', value: String(index % 7) }],
	}),
)

/** The ids of A holding k="3" the engine answers on the document. */
async function holdersOf(engine: SqliteEngine): Promise<string[]> {
	const records = await engine.getByAttributes({
		documentId: DOCUMENT_ID,
		tagName: 'A',
		attributes: [{ name: 'k', values: ['3'] }],
	})
	return records.map((record) => record.id)
}

/** Let the engine's background work have many turns. */
async function manyTurns(): Promise<void> {
	for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setTimeout(resolve))
}

/** Whether the document's index rows equal their recomputation from its records. */
function isExact(params: { db: Database; seq: number }): boolean {
	return JSON.stringify(indexRowsOf(params)) === JSON.stringify(recomputedIndexRowsOf(params))
}

describe('a pair whose build fails', () => {
	it('the file full after the first slice → the pair left building, the lookups answered by filter, a write lands, no new try by that engine; the next lookup after a start queues the build again (lazy), exact', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		let seq = 0
		let armed = false
		const engine = await startEngine({
			db,
			options: { reclaimSliceMs: 0 },
			// after the slice that registered the pair: the file may grow no more
			onWork: function capOnceBuilding() {
				if (!armed || pairStatesOf({ db, seq })['A.k'] !== 'building') return
				armed = false
				db.exec(`PRAGMA max_page_count = ${Number(db.selectValue('PRAGMA page_count'))}`)
			},
		})
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY })
		seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function refusedThenResumed(): Promise<Record<string, unknown>> {
			armed = true
			const first = await holdersOf(engine)
			await manyTurns()
			const afterRefusal = pairStatesOf({ db, seq })
			db.exec('PRAGMA max_page_count = 1073741823')
			await engine.bulkWrite(DOCUMENT_ID, {
				creates: [makeRecord({ id: 'new', tagName: 'A', attributes: [{ name: 'k', value: '3' }] })],
				deletes: ['r0003'],
			})
			const meanwhile = await holdersOf(engine)
			await manyTurns()
			const sameEngine = pairStatesOf({ db, seq })
			engine.close()
			const nextDb = file.connect()
			const next = await startEngine({ db: nextDb })
			await holdersOf(next)
			await untilPairsReady({ db: nextDb, seq, pairs: 1 })
			return {
				first: first.length,
				afterRefusal,
				meanwhile: meanwhile.length,
				sameEngine,
				built: (await holdersOf(next)).length,
				exact: isExact({ db: nextDb, seq }),
			}
		}
		// 714 hold 3 (index % 7); then one more (new), one fewer (r0003)
		await expect(refusedThenResumed()).resolves.toEqual({
			first: 714,
			afterRefusal: { 'A.k': 'building' },
			meanwhile: 714,
			sameEngine: { 'A.k': 'building' },
			built: 714,
			exact: true,
		})
	})
})

describe('a lookup while another document imports', () => {
	it('the first lookup of a pair meanwhile → answered, nothing registered while the import runs; built once it has ended', async () => {
		const reached = Promise.withResolvers<void>()
		const released = Promise.withResolvers<void>()
		holds.push(released.resolve)
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function createHeldSession() {
					return {
						afterImport: async function holdUntilReleased() {
							reached.resolve()
							await released.promise
							return {}
						},
					}
				},
			},
		}
		const db = (await openMemoryFile({ opened })).connect()
		const engine = await startEngine({ db, runtime })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite(DOCUMENT_ID, { creates: MANY.slice(0, 70) })
		const seq = seqOf({ db, documentId: DOCUMENT_ID })
		async function duringThenAfter(): Promise<Record<string, unknown>> {
			const importing = engine.importFile({
				file: contractFile({ body: '<A/>' }),
				writeId: 'w-1',
				clientId: 'c-1',
			})
			await reached.promise
			const during = await holdersOf(engine)
			await manyTurns()
			const whileImporting = pairStatesOf({ db, seq })
			released.resolve()
			await importing
			await untilPairsReady({ db, seq, pairs: 1 })
			return { during, whileImporting, after: await holdersOf(engine), exact: isExact({ db, seq }) }
		}
		const holding = [
			'r0003',
			'r0010',
			'r0017',
			'r0024',
			'r0031',
			'r0038',
			'r0045',
			'r0052',
			'r0059',
			'r0066',
		]
		await expect(duringThenAfter()).resolves.toEqual({
			during: holding,
			whileImporting: {},
			after: holding,
			exact: true,
		})
	})
})
