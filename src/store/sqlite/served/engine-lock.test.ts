import { makeDocument } from '../../contract/store-contract.fixtures'
import { createInProcessConnector } from '../adapter/in-process-link'
import { EngineStore } from './engine-store'

import { describe, expect, it } from 'vitest'

describe('a project’s key', () => {
	it('two projects whose parts joined as they are would read the same → opened apart: neither holds the other’s documents', async () => {
		const suffix = crypto.randomUUID()
		const first = await openInProcess({ dialecteId: `a-${suffix}`, name: 'b/c' })
		const second = await openInProcess({ dialecteId: `a-${suffix}/b`, name: 'c' })
		try {
			await first.registerDocument(makeDocument({ id: 'first' }))
			const secondDocuments = await second.getDocuments()
			expect(secondDocuments).toEqual([])
			await second.registerDocument(makeDocument({ id: 'second' }))
			const firstDocuments = await first.getDocuments()
			expect(firstDocuments.map((document) => document.id)).toEqual(['first'])
		} finally {
			await first.destroy()
			await second.destroy()
		}
	})
})

/** An open store of that dialecte and name, its engine in this realm. */
async function openInProcess(params: { dialecteId: string; name: string }): Promise<EngineStore> {
	const { dialecteId, name } = params
	const store = new EngineStore({ name, connector: createInProcessConnector({ name, dialecteId }) })
	await store.open()
	return store
}
