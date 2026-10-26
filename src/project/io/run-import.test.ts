import { runImport } from './run-import'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEV_NAMESPACE } from '@/test'

import type { StoreRuntime } from './store-runtime.types'
import type { DialecteErrorKey } from '@/errors'
import type { ImportFileOptions, Store } from '@/store/store.types'
import type { AnyDialecteConfig, AnyRawRecord, DialecteHooks } from '@/types'

// Through a real in-memory store, no parse mock: what one import registers, stores and answers.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const NS = CONFIG.namespaces.default.uri
const ALT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	io: { supportedFileExtensions: ['.alt', '.scd'] },
} as unknown as AnyDialecteConfig

function xmlFile(params: { body: string; name?: string; closed?: boolean }): File {
	const { body, name = 'test.xml', closed = true } = params
	return new File([`<Root xmlns="${NS}">${body}${closed ? '</Root>' : ''}`], name, {
		type: 'text/xml',
	})
}

function runtime(hooks?: DialecteHooks<AnyDialecteConfig>): StoreRuntime {
	return { configs: { default: CONFIG, alt: ALT_CONFIG }, defaultConfigKey: 'default', hooks }
}

async function openStore(): Promise<InMemoryStore> {
	const store = new InMemoryStore(`run-import-${crypto.randomUUID()}`)
	await store.open()
	return store
}

/** The structured error an action rejects with. */
async function rejection(action: Promise<unknown>) {
	const thrown = await action.then(
		() => undefined,
		(error: unknown) => error,
	)
	expect(thrown, 'expected a rejection').toBeDefined()
	return toDialecteError(thrown)
}

describe('runImport - the document registered', () => {
	type TestCase = {
		fileName: string
		options?: ImportFileOptions
		expected: { name: string; extension: string; configKey: string }
	}
	const testCases: Record<string, TestCase> = {
		'a .xml file under the default config': {
			fileName: 'station.xml',
			expected: { name: 'station', extension: '.xml', configKey: 'default' },
		},
		'a name with dots keeps them': {
			fileName: 'station.v2.3.xml',
			expected: { name: 'station.v2.3', extension: '.xml', configKey: 'default' },
		},
		'an extension written in capitals is kept as written': {
			fileName: 'STATION.XML',
			expected: { name: 'STATION', extension: '.XML', configKey: 'default' },
		},
		'the config key given, and an extension of its config': {
			fileName: 'my-project.scd',
			options: { configKey: 'alt' },
			expected: { name: 'my-project', extension: '.scd', configKey: 'alt' },
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = await openStore()
			const result = await runImport({
				store,
				runtime: runtime(),
				file: xmlFile({ body: '', name: testCase.fileName }),
				options: { ...testCase.options, metadata: { source: 'upload' } },
				writeId: 'w',
			})
			expect(result.record).toEqual({
				id: expect.any(String),
				...testCase.expected,
				createdAt: expect.any(Number),
				metadata: { source: 'upload' },
				status: 'ready',
				writeId: 'w',
			})
			expect(await store.getDocuments()).toEqual([result.record])
		})
	}
})

describe('runImport - refused, nothing left', () => {
	type TestCase = {
		file: File
		options?: ImportFileOptions
		hooks?: DialecteHooks<AnyDialecteConfig>
		/** a store that fails its n-th write; its removal fails too when `removalFails` */
		failingWrite?: number
		removalFails?: boolean
		/** the document removed from the store by the session's afterImport, as another realm could */
		removedBySession?: boolean
		expected: { key: DialecteErrorKey; detail: RegExp; cause?: RegExp }
	}
	const testCases: Record<string, TestCase> = {
		'an unknown config key → UNKNOWN_CONFIG_KEY naming the keys, nothing registered': {
			file: xmlFile({ body: '<A/>' }),
			options: { configKey: 'nonexistent' },
			expected: { key: 'UNKNOWN_CONFIG_KEY', detail: /"nonexistent".*default, alt/ },
		},
		'a file the config does not take → ASSERTION_FAILED': {
			file: xmlFile({ body: '<A/>', name: 'plant.scd' }),
			expected: { key: 'ASSERTION_FAILED', detail: /Unsupported file type: plant\.scd/ },
		},
		'a session that throws → IMPORT_FAILED, its error as the cause': {
			file: xmlFile({ body: '<A/>' }),
			hooks: {
				createImportSession: () => ({
					afterImport: async () => {
						throw new Error('hook failed')
					},
				}),
			},
			expected: { key: 'IMPORT_FAILED', detail: /hook failed/, cause: /hook failed/ },
		},
		'the store fails on the second batch → IMPORT_FAILED, its error as the cause': {
			file: xmlFile({ body: '<A/><B aB="1"/><C/>' }),
			options: { chunkOptions: { chunkSize: 16, batchSize: 1 } },
			failingWrite: 2,
			expected: { key: 'IMPORT_FAILED', detail: /disk full/, cause: /disk full/ },
		},
		'the document removed before it is ready → DOCUMENT_NOT_REGISTERED, never answered ready': {
			file: xmlFile({ body: '<A/>' }),
			removedBySession: true,
			expected: { key: 'DOCUMENT_NOT_REGISTERED', detail: /removed while it imported/ },
		},
		'a malformed file whose removal fails too → the parse failure is the one thrown': {
			file: xmlFile({ body: '<A><AA_1></A>' }),
			removalFails: true,
			expected: { key: 'PARSE_ERROR', detail: /Unexpected close tag/ },
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = await openStore()
			let writes = 0
			if (testCase.failingWrite) {
				const bulkWrite = store.bulkWrite.bind(store)
				store.bulkWrite = async (...args: Parameters<Store['bulkWrite']>) => {
					writes += 1
					if (writes === testCase.failingWrite) throw new Error('disk full')
					return bulkWrite(...args)
				}
			}
			const removeDocument = store.removeDocument.bind(store)
			if (testCase.removalFails) {
				store.removeDocument = async () => {
					throw new Error('store closed')
				}
			}

			const hooks: DialecteHooks<AnyDialecteConfig> | undefined = testCase.removedBySession
				? {
						createImportSession: ({ documentId }) => ({
							afterImport: async () => {
								await store.removeDocument(documentId)
								return {}
							},
						}),
					}
				: testCase.hooks
			const error = await rejection(
				runImport({
					store,
					runtime: runtime(hooks),
					file: testCase.file,
					options: testCase.options,
					writeId: 'w',
				}),
			)

			expect(error?.key).toBe(testCase.expected.key)
			expect(error?.detail).toMatch(testCase.expected.detail)
			if (testCase.expected.cause) {
				expect(String((error?.cause as Error | undefined)?.message)).toMatch(
					testCase.expected.cause,
				)
			}
			if (testCase.failingWrite) expect(writes).toBe(testCase.failingWrite)
			if (testCase.removalFails) {
				// the row stays `importing`: the next store start removes it
				expect((await store.getDocuments()).map((document) => document.status)).toEqual([
					'importing',
				])
				store.removeDocument = removeDocument
				await store.close()
				await store.open()
			}
			expect(await store.getDocuments()).toEqual([])
		})
	}
})

describe('runImport - the session and the records it is handed', () => {
	type TestCase = {
		recordTagNames?: readonly string[]
		expected: { tagName: string; ancestry: string[] }[]
	}
	const testCases: Record<string, TestCase> = {
		'no tag names declared → every record, each with its open ancestors': {
			expected: [
				{ tagName: 'AA_1', ancestry: ['Root', 'A'] },
				{ tagName: 'A', ancestry: ['Root'] },
				{ tagName: 'B', ancestry: ['Root'] },
				{ tagName: 'Root', ancestry: [] },
			],
		},
		'tag names declared → the records of those tags only': {
			recordTagNames: ['AA_1', 'B'],
			expected: [
				{ tagName: 'AA_1', ancestry: ['Root', 'A'] },
				{ tagName: 'B', ancestry: ['Root'] },
			],
		},
		'an empty list declared → no record': { recordTagNames: [], expected: [] },
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const handed: { tagName: string; ancestry: string[] }[] = []
			const hooks: DialecteHooks<AnyDialecteConfig> = {
				createImportSession: () => ({
					recordTagNames: testCase.recordTagNames,
					beforeImportRecord: ({ record, ancestry }) => {
						handed.push({
							tagName: record.tagName,
							ancestry: ancestry.map((ancestor: AnyRawRecord) => ancestor.tagName),
						})
					},
				}),
			}

			await runImport({
				store: await openStore(),
				runtime: runtime(hooks),
				file: xmlFile({ body: '<A><AA_1/></A><B aB="1"/>' }),
				writeId: 'w',
			})

			expect(handed).toEqual(testCase.expected)
		})
	}
})

describe('runImport - what it hands back', () => {
	it('the record count counts the session’s creates and deletes; perf off → no timings', async () => {
		const store = await openStore()
		const hooks: DialecteHooks<AnyDialecteConfig> = {
			createImportSession: () => {
				const seen: AnyRawRecord[] = []
				return {
					recordTagNames: ['A'],
					beforeImportRecord: ({ record }) => seen.push(record),
					afterImport: async () => ({ deletes: seen.map((record) => record.id) }),
				}
			},
		}

		const result = await runImport({
			store,
			runtime: runtime(hooks),
			file: xmlFile({ body: '<A/><A/><B aB="1"/>' }),
			writeId: 'w',
		})

		expect(result.recordCount).toBe(2)
		expect(await store.count(result.record.id)).toBe(2)
		expect(result.perf).toBeUndefined()
	})

	it('custom record ids are taken from the file when asked', async () => {
		const store = await openStore()
		const result = await runImport({
			store,
			runtime: runtime(),
			file: new File(
				[
					`<Root xmlns="${NS}" ${XMLNS_DEV_NAMESPACE}><A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a-1"/></Root>`,
				],
				'custom.xml',
				{ type: 'text/xml' },
			),
			options: { useCustomRecordsIds: true },
			writeId: 'w',
		})
		expect((await store.get('a-1', result.record.id))?.tagName).toBe('A')
	})
})
