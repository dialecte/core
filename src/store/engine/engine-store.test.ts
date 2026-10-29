import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	sessionRecords,
} from '../contract/store-contract.fixtures'
import { createInProcessConnector } from '../sqlite/adapter/in-process-link'
import { EngineStore } from './engine-store'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE } from '@/test/test-dialecte'

/** The names a case used: destroyed after it, whatever state its stores were left in. */
const usedNames: string[] = []

afterEach(async () => {
	for (const name of usedNames.splice(0)) await openStore({ name }).destroy()
})

function openStore(params: { name: string }): EngineStore {
	const { name } = params
	return new EngineStore({
		name,
		connector: createInProcessConnector({ name, dialecteId: TEST_DIALECTE.id }),
	})
}

/** An open store of a name of its own, holding `doc-1` with record `r1`. */
async function seededStore(): Promise<EngineStore> {
	const name = `engine-store-${crypto.randomUUID()}`
	usedNames.push(name)
	const store = openStore({ name })
	await store.open()
	await store.registerDocument(makeDocument())
	await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
	return store
}

describe('EngineStore', () => {
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
