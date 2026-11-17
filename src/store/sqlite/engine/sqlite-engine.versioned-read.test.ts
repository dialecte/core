import { expectRejectsWith, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { openMemoryFile, startEngine } from './engine.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import type { SqliteEngine } from './engine.types'
import type { StoreVersion, VersionedRead } from '@/store/store.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The databases a case opened, closed after it (an in-memory file goes with its last connection). */
const opened: Database[] = []

afterEach(() => {
	for (const db of opened.splice(0)) db.close()
})

const DOCUMENT_ID = 'doc-1'

/** An engine on a file of its own, `doc-1` registered holding `a`; `connect` opens the same file again. */
async function seededEngine(): Promise<{ engine: SqliteEngine; connect: () => Database }> {
	const { keeper, connect } = await openMemoryFile({ opened })
	const engine = await startEngine({ db: keeper })
	await engine.registerDocument(makeDocument())
	await engine.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'a' })] })
	return { engine, connect }
}

/** The document's version, as the engine answers it with a read of `a`. */
async function versionOf(params: { engine: SqliteEngine }): Promise<StoreVersion> {
	const answer = await params.engine.readVersioned({
		documentId: DOCUMENT_ID,
		read: { member: 'get', args: ['a', DOCUMENT_ID] },
	})
	return answer.version
}

/** Two versions, read before and after `between` (which answers the engine to read the second from), compared. */
async function compareAcross(params: {
	engine: SqliteEngine
	between: (engine: SqliteEngine) => Promise<SqliteEngine>
}): Promise<{ sameEngine: boolean; sameCount: boolean }> {
	const { engine, between } = params
	const before = await versionOf({ engine })
	const next = await between(engine)
	const after = await versionOf({ engine: next })
	next.close()
	return { sameEngine: after.engineId === before.engineId, sameCount: after.count === before.count }
}

describe('the SQLite engine reads with the document version', () => {
	type TestCase = {
		between: (params: { engine: SqliteEngine; connect: () => Database }) => Promise<SqliteEngine>
		expected: { sameEngine: boolean; sameCount: boolean }
	}
	const testCases: Record<string, TestCase> = {
		'two reads, nothing written between → the same engine id and count': {
			between: async ({ engine }) => engine,
			expected: { sameEngine: true, sameCount: true },
		},
		'a write between → the same engine id, the count moved on': {
			between: async ({ engine }) => {
				await engine.bulkWrite(DOCUMENT_ID, { creates: [makeRecord({ id: 'b' })] })
				return engine
			},
			expected: { sameEngine: true, sameCount: false },
		},
		'an engine started again on the same file → another engine id, its count started over': {
			between: async ({ engine, connect }) => {
				const db = connect()
				engine.close()
				return startEngine({ db })
			},
			expected: { sameEngine: false, sameCount: false },
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const { between, expected } = testCase
			const { engine, connect } = await seededEngine()
			await expect(
				compareAcross({ engine, between: (current) => between({ engine: current, connect }) }),
			).resolves.toEqual(expected)
		})
	}

	it('a member that is not a read → refused ASSERTION_FAILED, nothing run', async () => {
		const { engine } = await seededEngine()
		const read = { member: 'removeDocument', args: [DOCUMENT_ID] } as unknown as VersionedRead
		await expectRejectsWith({
			action: engine.readVersioned({ documentId: DOCUMENT_ID, read }),
			key: 'ASSERTION_FAILED',
		})
		await expect(engine.getDocument(DOCUMENT_ID)).resolves.toBeDefined()
		engine.close()
	})
})
