import { CONTRACT_SESSION_FAIL_VALUE } from '../../contract/store-contract.constants'
import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	sessionRecords,
} from '../../contract/store-contract.fixtures'
import {
	createContractRuntime,
	holdContractImport,
	untilHeld,
} from '../../contract/store-contract.import-session'
import { loadSqlite } from '../load-sqlite'
import { openMemoryFile, startEngine, untilNoFreePages } from './engine.fixtures'
import { freePagesOf } from './reclaim'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { yieldToQueue } from '@/utils/yield-to-queue'

import type { SqliteEngineOptions } from './engine.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** Every statement its own slice: a reclaim of a few hundred pages yields many times. */
const MANY_SLICES: Partial<SqliteEngineOptions> = {
	reclaimSliceMs: 0,
	reclaimPagesPerStatement: 64,
}

/** About 4 MB of records: some thousand pages to give back once they go. */
function bulkyRecords(params: { count: number; prefix?: string }): AnyRawRecord[] {
	const { count, prefix = 'r' } = params
	return Array.from({ length: count }, (_, index) =>
		makeRecord({ id: `${prefix}${index}`, value: 'x'.repeat(200) }),
	)
}

/** A task of the message task source, as a client's call over a port is: true once it has run. */
function queueMessageTurn(): { ran: () => boolean } {
	const channel = new MessageChannel()
	let ran = false
	channel.port1.onmessage = function markRan() {
		ran = true
		channel.port1.close()
	}
	channel.port2.postMessage(undefined)
	return { ran: () => ran }
}

/**
 * A file whose every chunk is read after a message turn, as a file read from disk comes in tasks: an
 * import reading it waits between its chunks with its window open.
 */
function slowFile(params: { file: File }): File {
	const { file } = params
	return new (class SlowFile extends File {
		stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
			const reader = file.stream().getReader()
			return new ReadableStream({
				pull: async function readAfterTurn(controller) {
					await yieldToQueue()
					const { done, value } = await reader.read()
					if (!done) return controller.enqueue(value)
					reader.releaseLock()
					controller.close()
				},
			})
		}
	})([file], file.name, { type: file.type })
}

/**
 * Export a document of six records and, at its first progress, remove it and register another
 * document (which takes the removed one's table number) holding the same ids, marked: what the export
 * answers - its text, or its refusal's key.
 */
async function exportAcrossRemoval(params: {
	options?: Partial<SqliteEngineOptions>
}): Promise<string> {
	const file = await openMemoryFile({ opened })
	const engine = await startEngine({
		db: file.connect(),
		options: params.options,
		runtime: createContractRuntime(),
	})
	const { record } = await engine.importFile({
		file: contractFile({ body: sessionRecords(6) }),
		writeId: 'w-import',
		clientId: 'c-1',
	})
	// the other document holds the same ids, each marked: a read by id on the wrong table finds them
	const marked = (await engine.getByDocumentId(record.id)).map((held) => ({
		...held,
		attributes: [...held.attributes, { name: 'other', value: 'other' }],
	}))
	let told = false
	const exporting = engine.exportFile(
		{ documentId: record.id, options: { batchSize: 1 }, exportId: 'e-1', clientId: 'c-1' },
		function removeAtFirstProgress() {
			if (told) return
			told = true
			void engine.removeDocument(record.id)
			// registered while the removal gives its pages back: the removed table's number again
			void engine.registerDocument(makeDocument({ id: 'doc-other' }))
			void engine.bulkWrite('doc-other', { creates: marked })
		},
	)
	try {
		return await (await exporting).file.text()
	} catch (thrown) {
		return toDialecteError(thrown)?.key ?? String(thrown)
	}
}

describe('the free pages given back in steps', () => {
	it('a document of 20,000 records removed → a message queued at the call runs before the removal resolves; no free page once it has', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db, options: MANY_SLICES })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite('doc-1', { creates: bulkyRecords({ count: 20_000 }) })
		const removing = engine.removeDocument('doc-1')
		const turn = queueMessageTurn()
		await removing
		expect(turn.ran()).toBe(true)
		expect(freePagesOf({ db })).toBe(0)
	})

	it('a document of 20,000 records removed → the engine tells it works after each reclaim statement (too few steps for SQLite’s progress handler)', async () => {
		const file = await openMemoryFile({ opened })
		let told = 0
		const engine = await startEngine({
			db: file.connect(),
			options: MANY_SLICES,
			onWork: function countWork() {
				told += 1
			},
		})
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite('doc-1', { creates: bulkyRecords({ count: 20_000 }) })
		told = 0
		await engine.removeDocument('doc-1')
		expect(told).toBeGreaterThan(5)
	})

	it('an import failing after storing 20,000 records → a message queued at its last progress runs before it rejects; nothing left, no free page', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({
			db,
			options: MANY_SLICES,
			runtime: createContractRuntime(),
		})
		const body =
			Array.from({ length: 20_000 }, (_, index) => `<A aA="${'x'.repeat(200)}${index}"/>`).join(
				'',
			) + `<B aB="B0" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>`
		let lastTurn: { ran: () => boolean } | undefined
		const importing = engine.importFile(
			{ file: contractFile({ body }), writeId: 'w-fail', clientId: 'client-1' },
			function queueTurnAtProgress() {
				lastTurn = queueMessageTurn()
			},
		)
		await expectRejectsWith({ action: importing, key: 'IMPORT_FAILED' })
		expect(lastTurn?.ran()).toBe(true)
		expect(await engine.getDocuments()).toEqual([])
		expect(freePagesOf({ db })).toBe(0)
	})

	it('an export of a document removed and its table number taken again while the removal gives its pages back → answers as with no step: never the other document’s records', async () => {
		const inOneStep = await exportAcrossRemoval({})
		const inSteps = await exportAcrossRemoval({ options: MANY_SLICES })
		expect(inSteps).toBe(inOneStep)
		expect(inSteps).not.toContain('other')
	})

	describe('a file holding a dead import of 20,000 records in front of a ready document', () => {
		async function fileWithDeadImport(): ReturnType<typeof openMemoryFile> {
			const file = await openMemoryFile({ opened })
			const first = await startEngine({ db: file.connect() })
			await first.registerDocument(makeDocument({ id: 'kept' }))
			await first.registerDocument(makeDocument({ id: 'left', status: 'importing' }))
			await first.bulkWrite('left', { creates: bulkyRecords({ count: 20_000 }) })
			first.close()
			return file
		}

		it('the engine starts → it answers before its free pages are back, which they then are', async () => {
			const file = await fileWithDeadImport()
			const db = file.connect()
			const engine = await startEngine({ db, options: MANY_SLICES })
			expect(freePagesOf({ db })).toBeGreaterThan(0)
			expect((await engine.getDocuments()).map((document) => document.id)).toEqual(['kept'])
			expect(freePagesOf({ db })).toBeGreaterThan(0)
			await untilNoFreePages({ db })
		})

		it('an import started while it gives the pages back → no page given back while the import runs (its window never settled for one); the rest once it has ended', async () => {
			const file = await fileWithDeadImport()
			const db = file.connect()
			const engine = await startEngine({
				db,
				options: MANY_SLICES,
				runtime: createContractRuntime(),
			})
			const hold = holdContractImport()
			const importing = engine.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-during-reclaim',
				clientId: 'c-1',
			})
			try {
				await untilHeld({ hold, importing })
				const atHold = freePagesOf({ db })
				expect(atHold).toBeGreaterThan(0)
				// the turns the reclaim would take steps in
				for (let turn = 0; turn < 20; turn += 1) await yieldToQueue()
				expect(freePagesOf({ db })).toBe(atHold)
			} finally {
				hold.release()
			}
			await importing
			await untilNoFreePages({ db })
		})

		it('the engine closed while it gives the pages back → nothing thrown; the next start gives back the rest', async () => {
			const file = await fileWithDeadImport()
			const engine = await startEngine({ db: file.connect(), options: MANY_SLICES })
			engine.close()
			await yieldToQueue()
			expect(freePagesOf({ db: file.keeper })).toBeGreaterThan(0)
			const db = file.connect()
			await startEngine({ db })
			await untilNoFreePages({ db })
		})
	})

	it('a document of 60,000 records removed while an import writes in its window (it reuses fewer pages than are freed) → every reclaim step outside the window; the import ready with all its records, the connection durable after', async () => {
		const sqlite3 = await loadSqlite()
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		/** For each reclaim statement, whether a transaction was open when it began. */
		const stepsInTransaction: boolean[] = []
		const prepare = db.prepare.bind(db)
		db.prepare = function recordReclaimSteps(sql) {
			if (typeof sql === 'string' && sql.startsWith('PRAGMA incremental_vacuum')) {
				stepsInTransaction.push(sqlite3.capi.sqlite3_get_autocommit(db) === 0)
			}
			return prepare(sql)
		} as Database['prepare']
		const engine = await startEngine({
			db,
			options: { ...MANY_SLICES, importWindowMs: 60_000 },
			runtime: createContractRuntime(),
		})
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite('doc-1', { creates: bulkyRecords({ count: 60_000 }) })
		let removing: Promise<boolean> | undefined
		const { record, recordCount } = await engine.importFile(
			{
				// ~2.5 MB: the file is read in many chunks, the import waiting between them in its window
				file: slowFile({
					file: contractFile({
						body: Array.from(
							{ length: 20_000 },
							(_, index) => `<A aA="${'y'.repeat(100)}${index}"/>`,
						).join(''),
					}),
				}),
				writeId: 'w-import',
				clientId: 'c-1',
			},
			function removeAtFirstProgress() {
				removing ??= engine.removeDocument('doc-1')
			},
		)
		await removing
		expect(stepsInTransaction.length).toBeGreaterThan(1)
		expect(stepsInTransaction).not.toContain(true)
		expect(await engine.count(record.id)).toBe(recordCount)
		expect(db.selectValue('PRAGMA synchronous')).toBe(2)
		expect((await engine.getDocuments()).map((document) => document.id)).toEqual([record.id])
		expect(freePagesOf({ db })).toBe(0)
	})

	it('a document of 20,000 records removed, the engine closed at once → the removal resolves (it is committed; the next start gives back the rest)', async () => {
		const file = await openMemoryFile({ opened })
		const engine = await startEngine({ db: file.connect(), options: MANY_SLICES })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite('doc-1', { creates: bulkyRecords({ count: 20_000 }) })
		const removing = engine.removeDocument('doc-1')
		engine.close()
		await removing
		expect(freePagesOf({ db: file.keeper })).toBeGreaterThan(0)
		const db = file.connect()
		const next = await startEngine({ db })
		expect(await next.getDocuments()).toEqual([])
		await untilNoFreePages({ db })
	})
})
