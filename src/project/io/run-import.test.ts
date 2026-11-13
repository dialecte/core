import { runImport } from './run-import'

import { describe, expect, it } from 'vitest'

import { createDiagnostic } from '@/diagnostics'
import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { IMPORT_CHECK_CHUNK_SIZE } from '@/store/import-progress/import-progress.constants'
import { findInMemoryState, inMemoryStateKeyOf } from '@/store/in-memory/in-memory-state'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { TEST_DIALECTE_CONFIG, XMLNS_DEV_NAMESPACE } from '@/test'

import type { StoreRuntime } from './store-runtime.types'
import type { DiagnosticCatalogue } from '@/diagnostics'
import type { DialecteErrorKey } from '@/errors'
import type {
	DistributiveOmit,
	ImportFileOptions,
	ImportProgress,
	ImportStepReport,
	ImportTarget,
	Store,
} from '@/store/store.types'
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

/**
 * The store's operations as an import's target, each read off the store when called (a case may replace one); the
 * document marked ready in the store's state, as the store's own import target does (no store call sets a status).
 */
function importTargetOf(store: InMemoryStore): ImportTarget {
	return {
		registerDocument: (document) => store.registerDocument(document),
		getDocument: (documentId) => store.getDocument(documentId),
		removeDocument: (documentId) => store.removeDocument(documentId),
		bulkWrite: (documentId, ops) => store.bulkWrite(documentId, ops),
		writeSession: (documentId, ops) => store.bulkWrite(documentId, ops),
		markReady: async function markReadyInState(documentId) {
			const state = findInMemoryState({ key: inMemoryStateKeyOf({ project: store.name }) })
			const document = state?.documents.get(documentId)
			if (!state || document?.status !== 'importing') {
				throw new Error(`no document ${documentId} importing to mark ready`)
			}
			state.documents.set(documentId, { ...document, status: 'ready' })
		},
	}
}

/** The diagnostics a session says while its writes are checked a chunk at a time. */
const CHUNK_DIAGNOSTICS = {
	source: 'test',
	codes: { seen: { severity: 'information', family: 'reference', message: 'Seen' } },
} as const satisfies DiagnosticCatalogue

/** A record a session creates, of no tag the file holds. */
const EXTRA_RECORD: AnyRawRecord = {
	id: 'extra-1',
	tagName: 'B',
	namespace: { prefix: '', uri: NS },
	attributes: [],
	value: '',
	parent: null,
	children: [],
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
				store: importTargetOf(store),
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
			const documents = await store.getDocuments()
			expect(documents).toEqual([result.record])
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
					store: importTargetOf(store),
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
				const documentsBeforeReopen = await store.getDocuments()
				expect(documentsBeforeReopen.map((document) => document.status)).toEqual(['importing'])
				store.removeDocument = removeDocument
				await store.close()
				await store.open()
			}
			const documents = await store.getDocuments()
			expect(documents).toEqual([])
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

			const store = await openStore()
			await runImport({
				store: importTargetOf(store),
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
			store: importTargetOf(store),
			runtime: runtime(hooks),
			file: xmlFile({ body: '<A/><A/><B aB="1"/>' }),
			writeId: 'w',
		})

		expect(result.recordCount).toBe(2)
		const recordCount = await store.count(result.record.id)
		expect(recordCount).toBe(2)
		expect(result.perf).toBeUndefined()
	})

	it('custom record ids are taken from the file when asked', async () => {
		const store = await openStore()
		const result = await runImport({
			store: importTargetOf(store),
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
		const recordA1 = await store.get('a-1', result.record.id)
		expect(recordA1?.tagName).toBe('A')
	})
})

describe('runImport - the progress it tells, phase by phase', () => {
	type TestCase = {
		hooks?: DialecteHooks<AnyDialecteConfig>
		/** the phases told, in order, without their bytes */
		expected: DistributiveOmit<ImportProgress, 'bytesRead' | 'totalBytes'>[]
	}
	const testCases: Record<string, TestCase> = {
		'a session reporting its steps and writing → storing, processing start then its steps, checking, applying, finishing':
			{
				hooks: {
					createImportSession: () => {
						const seen: string[] = []
						return {
							recordTagNames: ['A'],
							beforeImportRecord: ({ record }) => seen.push(record.id),
							afterImport: async ({ report }) => {
								report({ step: 'links', done: 1, total: 2 })
								report({ step: 'links', done: 2, total: 2 })
								report({ step: 'names' })
								return {
									updates: seen.map((recordId) => ({ recordId, value: 'v' })),
									diagnostics: [],
								}
							},
						}
					},
				},
				expected: [
					{ phase: 'storing' },
					{ phase: 'processing', step: 'start' },
					{ phase: 'processing', step: 'links', done: 1, total: 2 },
					{ phase: 'processing', step: 'links', done: 2, total: 2 },
					{ phase: 'processing', step: 'names' },
					{ phase: 'checking', done: 0, total: 2 },
					{ phase: 'checking', done: 2, total: 2 },
					{ phase: 'applying', done: 0, total: 2 },
					{ phase: 'applying', done: 2, total: 2 },
					{ phase: 'finishing' },
				],
			},
		'a session that reports nothing and writes nothing → processing start, checking, no applying, finishing':
			{
				hooks: {
					createImportSession: () => ({ afterImport: async () => ({}) }),
				},
				expected: [
					{ phase: 'storing' },
					{ phase: 'processing', step: 'start' },
					{ phase: 'checking', done: 0, total: 0 },
					{ phase: 'finishing' },
				],
			},
		'a dialecte without an import session → processing start, then finishing': {
			expected: [
				{ phase: 'storing' },
				{ phase: 'processing', step: 'start' },
				{ phase: 'finishing' },
			],
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = await openStore()
			const file = xmlFile({ body: '<A/><A/><B aB="1"/>' })
			const heard: ImportProgress[] = []
			const outcome = await runImport(
				{ store: importTargetOf(store), runtime: runtime(testCase.hooks), file, writeId: 'w' },
				{ onProgress: (progress) => heard.push(progress) },
			).then(
				() => 'imported',
				(thrown: unknown) => thrown,
			)
			expect(heard.map(({ bytesRead: _read, totalBytes: _total, ...told }) => told)).toEqual(
				testCase.expected,
			)
			expect(heard.every((progress) => progress.totalBytes === file.size)).toBe(true)
			expect(heard.slice(1).every((progress) => progress.bytesRead === file.size)).toBe(true)
			expect(outcome).toBe('imported')
		})
	}
})

describe('runImport - a step the session reports, taken field by field', () => {
	type TestCase = { reported: Record<string, unknown>; expected: Record<string, unknown> }
	const testCases: Record<string, TestCase> = {
		'a report holding a phase of its own → still told as processing, the phase dropped': {
			reported: { step: 'links', phase: 'checking', done: 1, total: 1 },
			expected: { phase: 'processing', step: 'links', done: 1, total: 1 },
		},
		'a report holding a value that is no number in done and total, and a field of its own → only the step told':
			{
				reported: { step: 'links', done: () => 1, total: '2', extra: { nested: true } },
				expected: { phase: 'processing', step: 'links' },
			},
	}
	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = await openStore()
			const file = xmlFile({ body: '<A/>' })
			const heard: ImportProgress[] = []
			const hooks: DialecteHooks<AnyDialecteConfig> = {
				createImportSession: () => ({
					afterImport: async ({ report }) => {
						report(testCase.reported as unknown as ImportStepReport)
						return {}
					},
				}),
			}
			await runImport(
				{ store: importTargetOf(store), runtime: runtime(hooks), file, writeId: 'w' },
				{ onProgress: (progress) => heard.push(progress) },
			)
			const reported = heard.filter(
				(progress) => progress.phase === 'processing' && progress.step === 'links',
			)
			expect(reported).toEqual([
				{ ...testCase.expected, bytesRead: file.size, totalBytes: file.size },
			])
		})
	}
})

describe('runImport - aborted while the session runs', () => {
	type TestCase = {
		/** what the session does once it sees the abort: stop with its own error, or return as if done */
		onAbort: 'throws' | 'returns'
	}
	const testCases: Record<string, TestCase> = {
		'the session throws its own error on the abort → IMPORT_ABORTED, nothing left': {
			onAbort: 'throws',
		},
		'the session returns its writes as if done → IMPORT_ABORTED, nothing left': {
			onAbort: 'returns',
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const store = await openStore()
			const controller = new AbortController()
			let sawAbort = false
			const hooks: DialecteHooks<AnyDialecteConfig> = {
				createImportSession: () => ({
					afterImport: async ({ signal }) => {
						controller.abort()
						sawAbort = signal.aborted
						if (testCase.onAbort === 'throws') throw new Error('stopped on abort')
						return { creates: [{ ...EXTRA_RECORD }] }
					},
				}),
			}
			const refusal = await rejection(
				runImport(
					{
						store: importTargetOf(store),
						runtime: runtime(hooks),
						file: xmlFile({ body: '<A/>' }),
						writeId: 'w',
					},
					{ signal: controller.signal },
				),
			)
			expect(refusal?.key).toBe('IMPORT_ABORTED')
			expect(sawAbort).toBe(true)
			const documents = await store.getDocuments()
			expect(documents).toEqual([])
		})
	}

	it('a step reported once the import is aborted → not told, the start before it told', async () => {
		const store = await openStore()
		const controller = new AbortController()
		const heard: ImportProgress[] = []
		const hooks: DialecteHooks<AnyDialecteConfig> = {
			createImportSession: () => ({
				afterImport: async ({ report }) => {
					controller.abort()
					report({ step: 'after-abort' })
					return {}
				},
			}),
		}
		await rejection(
			runImport(
				{
					store: importTargetOf(store),
					runtime: runtime(hooks),
					file: xmlFile({ body: '<A/>' }),
					writeId: 'w',
				},
				{ signal: controller.signal, onProgress: (progress) => heard.push(progress) },
			),
		)
		expect(
			heard.flatMap((progress) => (progress.phase === 'processing' ? [progress.step] : [])),
		).toEqual(['start'])
	})
})

describe('runImport - perf on', () => {
	it('each phase a span import::phase.<name>, each step the session reports a span import::hook.<step>', async () => {
		const store = await openStore()
		const hooks: DialecteHooks<AnyDialecteConfig> = {
			createImportSession: () => ({
				afterImport: async ({ report }) => {
					report({ step: 'links', done: 1, total: 1 })
					return { creates: [{ ...EXTRA_RECORD }] }
				},
			}),
		}
		const result = await runImport({
			store: importTargetOf(store),
			runtime: { ...runtime(hooks), perf: true },
			file: xmlFile({ body: '<A/>' }),
			writeId: 'w',
		})
		const names = new Set(result.perf?.spans.map((span) => span.name))
		for (const name of [
			'import::phase.storing',
			'import::phase.processing',
			'import::hook.links',
			'import::phase.checking',
			'import::phase.applying',
			'import::phase.finishing',
		]) {
			expect(names, name).toContain(name)
		}
	})
})

describe('runImport - the session checked a chunk at a time', () => {
	it('a diagnostic that is not JSON past the first chunk → STORE_VALUE_NOT_JSON naming the chunk it was in, nothing left', async () => {
		const store = await openStore()
		const total = IMPORT_CHECK_CHUNK_SIZE + 1
		const hooks: DialecteHooks<AnyDialecteConfig> = {
			createImportSession: () => ({
				afterImport: async () => ({
					diagnostics: Array.from({ length: total }, (_, index) =>
						createDiagnostic(CHUNK_DIAGNOSTICS, 'seen', {
							ref: { tagName: 'A', id: `a-${index}` },
							...(index === total - 1 && { meta: { fix: function notJson() {} } }),
						}),
					),
				}),
			}),
		}
		const refusal = await rejection(
			runImport({
				store: importTargetOf(store),
				runtime: runtime(hooks),
				file: xmlFile({ body: '<A/>' }),
				writeId: 'w',
			}),
		)
		expect(refusal?.key).toBe('STORE_VALUE_NOT_JSON')
		expect(refusal?.detail).toMatch(
			new RegExp(`among the diagnostics ${IMPORT_CHECK_CHUNK_SIZE}-${total - 1}\\)$`),
		)
		const documents = await store.getDocuments()
		expect(documents).toEqual([])
	})
})
