import { makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { Database } from '@sqlite.org/sqlite-wasm'

// The engine's document versions: a write that fails moves none.

const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

describe('the SQLite engine - the versions of a failed write', () => {
	it('a removal that fails (its table gone) → the document’s version where it was', async () => {
		const file = await openMemoryFile({ opened })
		const db = file.connect()
		const engine = await startEngine({ db })
		await engine.registerDocument(makeDocument())
		await engine.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
		const before = await engine.readVersion({ documentId: 'doc-1' })
		db.exec('DROP TABLE xel_1')
		const outcome = await engine.removeDocument('doc-1').then(
			() => 'removed',
			() => 'refused',
		)
		const after = await engine.readVersion({ documentId: 'doc-1' })
		expect({ outcome, after }).toEqual({ outcome: 'refused', after: before })
	})
})
