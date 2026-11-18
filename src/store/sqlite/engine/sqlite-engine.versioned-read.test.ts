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
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { StoreVersion, VersionedRead } from '@/store/store.types'
import type { AfterImportResult } from '@/types'
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

/**
 * The contract's runtime with a session that keeps the ids of the `B` records it is handed, tells `reached` after the
 * parse, waits for `released`, then answers the writes `writesOf` makes of those ids.
 */
function runtimeWritingAfterHold(params: {
	reached: () => void
	released: Promise<void>
	writesOf: (ids: string[]) => AfterImportResult
}): StoreRuntime {
	const { reached, released, writesOf } = params
	return {
		...createContractRuntime(),
		hooks: {
			createImportSession: function createHeldSession() {
				const ids: string[] = []
				return {
					recordTagNames: ['B'],
					beforeImportRecord: function keepId({ record }) {
						ids.push(record.id)
					},
					afterImport: async function writeAfterRelease() {
						reached()
						await released
						return writesOf(ids)
					},
				}
			},
		},
	}
}

/**
 * An import whose session holds after the parse, then writes: the version of its document read while held, and once
 * the import is done.
 */
async function versionsAcrossImport(params: {
	writesOf: (ids: string[]) => AfterImportResult
}): Promise<{ during: StoreVersion; after: StoreVersion }> {
	const { keeper } = await openMemoryFile({ opened })
	const reached = Promise.withResolvers<void>()
	const released = Promise.withResolvers<void>()
	const runtime = runtimeWritingAfterHold({
		reached: reached.resolve,
		released: released.promise,
		writesOf: params.writesOf,
	})
	const engine = await startEngine({ db: keeper, runtime })
	const file = contractFile({ body: '<B aB="B0"/><B aB="B1"/>' })
	const importing = engine.importFile({ file, writeId: 'w-1', clientId: 'c-1' })
	importing.catch(() => undefined)
	await reached.promise
	const [listed] = await engine.getDocuments()
	const read: VersionedRead = { member: 'getByDocumentId', args: [listed!.id] }
	const during = await engine.readVersioned({ documentId: listed!.id, read })
	released.resolve()
	await importing
	const after = await engine.readVersioned({ documentId: listed!.id, read })
	engine.close()
	return { during: during.version, after: after.version }
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

	describe('an import whose session writes after a read', () => {
		type ImportCase = { writesOf: (ids: string[]) => AfterImportResult }
		const importCases: Record<string, ImportCase> = {
			'its session creates a record → the version after it is another': {
				writesOf: () => ({ creates: [makeRecord({ id: 'made', tagName: 'B' })] }),
			},
			'its session patches a record → the version after it is another': {
				writesOf: (ids) => ({ updates: [{ recordId: ids[0]!, value: 'patched' }] }),
			},
			'its session deletes a record → the version after it is another': {
				writesOf: (ids) => ({ deletes: [ids[0]!] }),
			},
		}

		for (const [description, importCase] of Object.entries(importCases)) {
			it(description, async () => {
				const { during, after } = await versionsAcrossImport({ writesOf: importCase.writesOf })
				expect(after).not.toEqual(during)
			})
		}
	})
})
