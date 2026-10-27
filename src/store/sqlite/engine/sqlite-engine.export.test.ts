import {
	contractFile,
	expectRejectsWith,
	sessionRecords,
} from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import { loadSqlite } from '../load-sqlite'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

/** An engine on a file of its own holding one imported document of a few records; answers the document's id. */
async function engineWithDocument(): Promise<{ engine: SqliteEngine; documentId: string }> {
	const file = await openMemoryFile({ opened })
	const engine = await startEngine({ db: file.connect(), runtime: createContractRuntime() })
	const { record } = await engine.importFile({
		file: contractFile({ body: sessionRecords(6) }),
		writeId: 'w-import',
		clientId: 'c-1',
	})
	return { engine, documentId: record.id }
}

describe('an engine exporting a document', () => {
	type TestCase = {
		/** what is done at the export's first progress */
		atFirstProgress: (params: { engine: SqliteEngine; exportId: string }) => void
	}
	const testCases: Record<string, TestCase> = {
		'the engine closed while it exports → EXPORT_ABORTED, nothing else thrown': {
			atFirstProgress: ({ engine }) => engine.close(),
		},
		'the export aborted by its id while it runs → EXPORT_ABORTED': {
			atFirstProgress: ({ engine, exportId }) => void engine.abortExport({ exportId }),
		},
	}
	for (const [description, { atFirstProgress }] of Object.entries(testCases)) {
		it(description, async () => {
			const { engine, documentId } = await engineWithDocument()
			let told = false
			const exporting = engine.exportFile(
				{ documentId, options: { batchSize: 1 }, exportId: 'e-1', clientId: 'c-1' },
				function actAtFirstProgress() {
					if (told) return
					told = true
					atFirstProgress({ engine, exportId: 'e-1' })
				},
			)
			await expectRejectsWith({ action: exporting, key: 'EXPORT_ABORTED' })
		})
	}

	it('the engine closed while an export reads through its statement → EXPORT_ABORTED, no statement left when the connection closes', async () => {
		const sqlite3 = await loadSqlite()
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db, runtime: createContractRuntime() })
		const { record } = await engine.importFile({
			file: contractFile({ body: sessionRecords(6) }),
			writeId: 'w-import',
			clientId: 'c-1',
		})
		let statementsAtClose: number | undefined
		db.onclose = {
			before: function countStatements(closing: Database) {
				statementsAtClose = Number(sqlite3.capi.sqlite3_next_stmt(closing.pointer!, 0))
			},
		}
		let told = 0
		const exporting = engine.exportFile(
			{ documentId: record.id, options: { batchSize: 1 }, exportId: 'e-1', clientId: 'c-1' },
			function closeOnceReading() {
				// a few batches in: the export's statement is prepared and held
				told += 1
				if (told === 3) engine.close()
			},
		)
		await expectRejectsWith({ action: exporting, key: 'EXPORT_ABORTED' })
		expect(statementsAtClose).toBe(0)
	})

	it('an export asked under the id of one that runs → ASSERTION_FAILED; the running one completes', async () => {
		const { engine, documentId } = await engineWithDocument()
		let second: Promise<unknown> | undefined
		const first = engine.exportFile(
			{ documentId, options: { batchSize: 1 }, exportId: 'e-1', clientId: 'c-1' },
			function askAgainOnce() {
				if (second) return
				second = engine.exportFile({ documentId, exportId: 'e-1', clientId: 'c-2' })
				// asserted below, once the first export is done
				second.catch(() => undefined)
			},
		)
		const { file } = await first
		await expectRejectsWith({ action: second!, key: 'ASSERTION_FAILED' })
		expect(await file.text()).toContain('<Root')
	})

	it('the exports of a client aborted for it → EXPORT_ABORTED; another client’s export completes', async () => {
		const { engine, documentId } = await engineWithDocument()
		let aborted = false
		const ofGone = engine.exportFile(
			{ documentId, options: { batchSize: 1 }, exportId: 'e-gone', clientId: 'c-gone' },
			function abortItsClient() {
				if (aborted) return
				aborted = true
				engine.abortExportsOf({ clientId: 'c-gone' })
			},
		)
		const ofKept = engine.exportFile({
			documentId,
			options: { batchSize: 1 },
			exportId: 'e-kept',
			clientId: 'c-kept',
		})
		await expectRejectsWith({ action: ofGone, key: 'EXPORT_ABORTED' })
		expect(await (await ofKept).file.text()).toContain('<Root')
	})

	it('an id no export runs aborted → ignored: the export of another id completes', async () => {
		const { engine, documentId } = await engineWithDocument()
		const exporting = engine.exportFile({ documentId, exportId: 'e-1', clientId: 'c-1' })
		await engine.abortExport({ exportId: 'e-other' })
		const { file } = await exporting
		expect(await file.text()).toContain('<Root')
	})
})
