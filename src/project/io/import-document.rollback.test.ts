import { Project } from '../project'
import { importDocument } from './import-document'

import { describe, expect, it } from 'vitest'

import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { TABLE_DOCUMENTS } from '@/store/store.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { ImportEntry } from '../types'
import type { DexieStore } from '@/store/local/dexie-store'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'
import type Dexie from 'dexie'

// Through a real store, no parse mock: whatever fails after registration leaves nothing behind.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const configs = { default: CONFIG }
const NS = CONFIG.namespaces.default.uri

function xmlFile(body: string, name = 'test.xml'): File {
	return new File([`<Root xmlns="${NS}">${body}</Root>`], name, { type: 'text/xml' })
}

/** The ids of the documents an import landed; a failed entry fails the test. */
function documentIds(entries: ImportEntry[]): string[] {
	return entries.map((entry) => {
		if (entry.status === 'failed') throw new Error(`${entry.fileName}: ${entry.error.detail}`)
		return entry.documentId
	})
}

/** A store whose n-th bulkWrite fails, as a disk-full or closed backend would. */
function storeFailingOnWrite(failingCall: number): InMemoryStore & { writes: () => number } {
	const store = new InMemoryStore('rollback-test', { writable: true })
	const bulkWrite = store.bulkWrite.bind(store)
	let calls = 0
	store.bulkWrite = async (...args: Parameters<Store['bulkWrite']>) => {
		calls += 1
		if (calls === failingCall) throw new Error('disk full')
		return bulkWrite(...args)
	}
	return Object.assign(store, { writes: () => calls })
}

describe('importDocument - a document is whole or absent', () => {
	type TestCase = {
		file: File
		store?: InMemoryStore & { writes: () => number }
		hooks?: DialecteHooks<AnyDialecteConfig>
		expectedFailure: { key?: string; message: string }
		/** the batches written before the failure, when the store counts them */
		expectedWrites?: number
	}

	const testCases: Record<string, TestCase> = {
		'malformed xml → PARSE_ERROR, no document in the store': {
			file: xmlFile('<A><AA_1></A>', 'broken.xml'),
			expectedFailure: { key: 'PARSE_ERROR', message: 'Unexpected close tag' },
		},
		'a session hook throws → its error, no document in the store': {
			file: xmlFile('<A/>'),
			hooks: {
				createImportSession: () => ({
					afterImport: async () => {
						throw new Error('hook failed')
					},
				}),
			},
			expectedFailure: { message: 'hook failed' },
		},
		'the store fails on the second batch → its error, no document in the store': {
			file: xmlFile('<A/><B/><C/>'),
			store: storeFailingOnWrite(2),
			expectedFailure: { message: 'disk full' },
			expectedWrites: 2,
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = testCase.store ?? new InMemoryStore('rollback-test', { writable: true })
			await store.open()

			const importing = importDocument({
				file: testCase.file,
				store,
				configs,
				defaultConfigKey: 'default',
				options: { chunkOptions: { chunkSize: 16, batchSize: 1 } },
				hooks: testCase.hooks,
			})
			await expect(importing).rejects.toThrow(testCase.expectedFailure.message)
			if (testCase.expectedFailure.key) {
				await expect(importing).rejects.toMatchObject({
					cause: { key: testCase.expectedFailure.key },
				})
			}
			if (testCase.expectedWrites) expect(testCase.store!.writes()).toBe(testCase.expectedWrites)

			expect(await store.getDocuments()).toEqual([])
		})
	}

	it('through the project: two files → the second starts only once the first is in', async () => {
		const events: string[] = []
		const hooks: DialecteHooks<AnyDialecteConfig> = {
			createImportSession: ({ documentId }) => {
				events.push(`start ${documentId}`)
				return {
					afterImport: async () => {
						events.push(`end ${documentId}`)
						return {}
					},
				}
			},
		}
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'inMemory' },
			hooks,
		}).open('rollback-project')
		try {
			const [one, two] = documentIds(
				await project.import([xmlFile('<A/>', 'one.xml'), xmlFile('<B/>', 'two.xml')]),
			)
			expect(events).toEqual([`start ${one}`, `end ${one}`, `start ${two}`, `end ${two}`])
			expect((await project.getDocument(one!))!.name).toBe('one')
			expect((await project.getDocument(two!))!.name).toBe('two')
		} finally {
			await project.close()
		}
	})

	it('through the project on IndexedDB: a malformed file → PARSE_ERROR, no row, no record table', async () => {
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'local' },
		}).open(`rollback-${crypto.randomUUID()}`)
		try {
			await expect(project.importFile(xmlFile('<A>', 'broken.xml'))).rejects.toMatchObject({
				cause: { key: 'PARSE_ERROR' },
			})
			expect(await project.getDocuments()).toEqual([])
			expect([...project.state.documents.keys()]).toEqual([])
			const dexie = (
				project as unknown as { store: DexieStore }
			).store.getDatabaseInstance() as Dexie
			expect(await dexie.table(TABLE_DOCUMENTS).toArray()).toEqual([])
			expect(dexie.tables.map((t) => t.name).filter((n) => n.startsWith('xel_'))).toEqual([])
		} finally {
			await project.destroy()
		}
	})

	it('everything succeeds → one ready document, every record stored', async () => {
		const store = new InMemoryStore('rollback-test', { writable: true })
		await store.open()

		const result = await importDocument({
			file: xmlFile('<A/><B/>'),
			store,
			configs,
			defaultConfigKey: 'default',
			options: { chunkOptions: { chunkSize: 16, batchSize: 1 } },
		})

		expect(await store.getDocuments()).toEqual([
			expect.objectContaining({ id: result.documentId, status: 'ready' }),
		])
		expect(await store.getByDocumentId(result.documentId)).toHaveLength(3)
	})
})
