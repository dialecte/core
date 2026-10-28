import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
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
