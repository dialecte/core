import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	sessionRecords,
} from '../../contract/store-contract.fixtures'
import { createInProcessConnector } from './in-process-link'
import { SqliteStore } from './sqlite-store'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE } from '@/test/test-dialecte'

import type { Store } from '../../store.types'

/** The names a case used: destroyed after it, whatever state its stores were left in. */
const usedNames: string[] = []

afterEach(async () => {
	for (const name of usedNames.splice(0)) await openStore({ name }).destroy()
})

function openStore(params: { name: string }): SqliteStore {
	const { name } = params
	return new SqliteStore({
		name,
		connector: createInProcessConnector({ name, dialecteId: TEST_DIALECTE.id }),
	})
}

/** An open store of a name of its own, holding `doc-1` with record `r1`. */
async function seededStore(): Promise<SqliteStore> {
	const name = `sqlite-store-${crypto.randomUUID()}`
	usedNames.push(name)
	const store = openStore({ name })
	await store.open()
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
	return store
}

describe('SqliteStore', () => {
	type Operation = {
		run: (store: Store) => Promise<unknown>
		/** what the store reads once the operation has completed and the store is open again */
		expected: (store: Store) => Promise<void>
	}
	const operations: Record<string, Operation> = {
		registerDocument: {
			run: (store) => store.registerDocument(makeDocument({ id: 'doc-2' })),
			expected: async (store) =>
				expect((await store.getDocuments()).map((document) => document.id)).toEqual([
					'doc-1',
					'doc-2',
				]),
		},
		removeDocument: {
			run: (store) => store.removeDocument('doc-1'),
			expected: async (store) => expect(await store.getDocuments()).toEqual([]),
		},
		bulkWrite: {
			run: (store) => store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r9' })] }),
			expected: async (store) =>
				expect(await store.get('r9', 'doc-1')).toEqual(makeRecord({ id: 'r9' })),
		},
		getByDocumentId: {
			run: async (store) =>
				expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })]),
			expected: async () => {},
		},
	}

	describe('an operation running when the store is closed', () => {
		for (const [name, operation] of Object.entries(operations)) {
			it(`${name} → it completes; a later operation is refused STORE_CLOSED; opened again, its result is there`, async () => {
				const store = await seededStore()
				const running = operation.run(store)
				store.close()
				await running
				await expectRejectsWith({
					action: store.getDocuments(),
					key: 'STORE_CLOSED',
					meta: { storeName: store.name },
				})
				await store.open()
				await operation.expected(store)
			})

			it(`${name}, the store closed and opened again at once → it completes, then the store opens`, async () => {
				const store = await seededStore()
				const running = operation.run(store)
				store.close()
				const opening = store.open()
				await running
				await opening
				await operation.expected(store)
			})
		}
	})

	describe('a closed store', () => {
		for (const [name, operation] of Object.entries(operations)) {
			it(`${name} through it → STORE_CLOSED; opened again, the store as it was`, async () => {
				const store = await seededStore()
				store.close()
				await expectRejectsWith({
					action: operation.run(store),
					key: 'STORE_CLOSED',
					meta: { storeName: store.name },
				})
				await store.open()
				expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
				expect(await store.getByDocumentId('doc-1')).toEqual([makeRecord({ id: 'r1' })])
			})
		}

		it('open() then close() at once → the store ends closed: the open refused, the next operation too', async () => {
			const store = await seededStore()
			store.close()
			const opening = store.open()
			store.close()
			await expectRejectsWith({ action: opening, key: 'STORE_CLOSED' })
			await expectRejectsWith({ action: store.getDocuments(), key: 'STORE_CLOSED' })
			await store.open()
			expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
		})

		it('closed again → nothing thrown; destroyed → the name opens empty', async () => {
			const store = await seededStore()
			store.close()
			expect(() => store.close()).not.toThrow()
			await store.destroy()
			const reopened = openStore({ name: store.name })
			await reopened.open()
			expect(await reopened.getDocuments()).toEqual([])
		})
	})

	it('a store opened twice then closed → the engine closes with it: the next store of the name starts it again', async () => {
		const store = await seededStore()
		await store.registerDocument(makeDocument({ id: 'left', status: 'importing' }))
		await store.open()
		store.close()
		const next = openStore({ name: store.name })
		await next.open()
		// an engine start removes what an import left unfinished: it ran
		expect((await next.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
	})

	it('a connection released → it reaches no engine: STORE_CLOSED', async () => {
		const store = await seededStore()
		store.close()
		const connector = createInProcessConnector({ name: store.name, dialecteId: TEST_DIALECTE.id })
		const link = await connector.connect()
		link.close()
		await expectRejectsWith({ action: link.engine(), key: 'STORE_CLOSED' })
	})

	it('a store with no dialecte asked an import with a signal already aborted → IMPORT_FAILED, as every store answers', async () => {
		const store = await seededStore()
		await expectRejectsWith({
			action: store.importFile({
				file: contractFile({ body: sessionRecords(1) }),
				signal: AbortSignal.abort(),
			}),
			key: 'IMPORT_FAILED',
		})
		expect((await store.getDocuments()).map((document) => document.id)).toEqual(['doc-1'])
	})
})
