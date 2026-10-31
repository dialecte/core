import {
	contractFile,
	expectRejectsWith,
	makeDocument,
} from '../../contract/store-contract.fixtures'
import { createContractRuntime } from '../../contract/store-contract.import-session'
import { EngineStore } from '../../engine/engine-store'
import { loadSqlite } from '../load-sqlite'
import { createInProcessConnector } from './in-process-link'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('an in-process engine an import breaks', () => {
	it('its window can neither roll back nor commit → the import refused; the next call answered by a new engine on the file: the document there, no trace of the import', async () => {
		const sqlite3 = await loadSqlite()
		// from the session's failure on, every connection of the realm can neither roll back nor commit (a lost handle)
		const armed = { failing: false }
		const exec = sqlite3.oo1.DB.prototype.exec as (...args: unknown[]) => unknown
		vi.spyOn(sqlite3.oo1.DB.prototype, 'exec').mockImplementation(function execUnlessArmed(
			this: Database,
			...args: unknown[]
		) {
			const [first] = args
			const sql = typeof first === 'string' ? first : (first as { sql?: string } | undefined)?.sql
			if (armed.failing && (sql === 'ROLLBACK' || sql === 'COMMIT')) {
				throw new Error(`${sql} refused`)
			}
			return exec.apply(this, args)
		} as typeof sqlite3.oo1.DB.prototype.exec)
		const runtime: StoreRuntime = {
			...createContractRuntime(),
			hooks: {
				createImportSession: function failingSession() {
					return {
						afterImport: async function failWithWindowStuck() {
							armed.failing = true
							throw new Error('the session fails')
						},
					}
				},
			},
		}
		const name = `in-process-broken-${crypto.randomUUID()}`
		const store = new EngineStore({
			name,
			connector: createInProcessConnector({ name, dialecteId: TEST_DIALECTE.id, runtime }),
		})
		await store.open()
		try {
			await store.registerDocument(makeDocument({ id: 'kept' }))
			await expectRejectsWith({
				action: store.importFile({
					file: contractFile({ body: '<B aB="B0"/>' }),
					writeId: 'w-stuck',
				}),
				key: 'IMPORT_FAILED',
			})
			armed.failing = false
			expect(await store.getDocuments()).toEqual([makeDocument({ id: 'kept' })])
			expect(await store.getWriteOutcome({ writeId: 'w-stuck' })).toBe('not-applied')
		} finally {
			armed.failing = false
			await store.destroy()
		}
	})
})
