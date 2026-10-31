import { xmlFile } from './import.fixtures'
import { Project } from './project'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { createDiagnostic, isKnownDiagnostic } from '@/diagnostics'
import { createDialecteError, defineErrors } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import {
	runTestCases,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type { StoreRuntime } from './io/store-runtime.types'
import type { ImportDocumentOptions, ImportedDocument, ImportEntry, StorageParam } from './types'
import type { Diagnostic, DiagnosticCatalogue } from '@/diagnostics'
import type { Ref } from '@/document'
import type { DialecteError } from '@/errors'
import type {
	ActParams,
	ActResult,
	BaseTestCase,
	BaseXmlTestCase,
	TestDialecteConfig,
} from '@/test'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// Through the public Project API on an in-memory store: what `import` and `importFile` return,
// what lands, what is broadcast - one entry per file, a failing file its own entry.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function imported(params: {
	fileName: string
	recordCount: number
	diagnostics?: Diagnostic[]
}): ImportEntry {
	const { fileName, recordCount, diagnostics = [] } = params
	return { status: 'imported', fileName, documentId: expect.any(String), recordCount, diagnostics }
}

const IMPORT_DIAGNOSTICS = {
	source: 'test',
	codes: {
		'unresolved-reference': {
			severity: 'warning',
			family: 'reference',
			message: 'A reference names an element the file does not hold',
		},
	},
} as const satisfies DiagnosticCatalogue

/** The same code under another source: a consumer naming only this catalogue must not match the other. */
const OTHER_DIAGNOSTICS = {
	source: 'other',
	codes: {
		'unresolved-reference': { severity: 'error', family: 'reference', message: 'Other: nothing' },
	},
} as const satisfies DiagnosticCatalogue

const UNRESOLVED_REFERENCE = createDiagnostic(IMPORT_DIAGNOSTICS, 'unresolved-reference', {
	ref: { tagName: 'A', id: 'a-1', attribute: 'ref' },
	meta: { pathValue: 'S1/Fn1', triedKeys: ['S1/Fn1'] },
})

/** Import hooks whose session has one thing to say about the file. */
const DIAGNOSING_HOOKS: DialecteHooks<AnyDialecteConfig> = {
	createImportSession: () => ({
		afterImport: async () => ({ diagnostics: [UNRESOLVED_REFERENCE] }),
	}),
}

const HOOK_ERRORS = defineErrors({
	HOOK_REFUSED: { code: 'T1001', message: 'The hook refused the file' },
})

const HOOK_REFUSAL: ImportEntry = {
	status: 'failed',
	fileName: 'refused.xml',
	error: {
		code: 'T1001',
		key: 'HOOK_REFUSED',
		message: 'The hook refused the file',
		detail: 'refused by the test hook',
		// built at this module's top level: no function frame to name
		method: 'unknown',
		ref: undefined,
		meta: { why: 'test' },
		cause: undefined,
	},
}

const PARSE_FAILURE: ImportEntry = {
	status: 'failed',
	fileName: 'broken.xml',
	error: {
		code: 'D5003',
		key: 'PARSE_ERROR',
		message: 'Failed to parse XML',
		detail: 'XML parsing error: Unexpected close tag',
		method: expect.stringMatching(/^[\w-]+\/src\/xml\/parse\/parser::SAXParser\.handleError$/),
		ref: undefined,
		meta: { reason: 'malformed-xml', parser: 'Unexpected close tag' },
		cause: undefined,
	},
}

const HOOK_ERROR = new Error('hook failed')

/** Import hooks whose session throws `thrown` once the file is parsed. */
function throwingHooks(thrown: unknown): DialecteHooks<AnyDialecteConfig> {
	return {
		createImportSession: () => ({
			afterImport: async () => {
				throw thrown
			},
		}),
	}
}

const HOOK_FAILURE: ImportEntry = {
	status: 'failed',
	fileName: 'hook.xml',
	error: {
		code: 'D5004',
		key: 'IMPORT_FAILED',
		message: 'Failed to import the file',
		detail: 'hook failed',
		// the first frame that is no raising function: the `catch` in `runImport`, which the store
		// ran. What precedes `/src/` is the file URL's (the dev-server port in a browser test, the
		// package folder in node)
		method: expect.stringMatching(/^[\w-]+\/src\/project\/io\/run-import::runImport$/),
		ref: undefined,
		meta: undefined,
		cause: HOOK_ERROR,
	},
}

/** What a custom store imports with: the project's configs and hooks. */
function runtime(hooks?: DialecteHooks<AnyDialecteConfig>): StoreRuntime {
	return { configs: { default: CONFIG, other: CONFIG }, defaultConfigKey: 'default', hooks }
}

async function openProject(
	params: { hooks?: DialecteHooks<AnyDialecteConfig>; storage?: StorageParam } = {},
) {
	const { hooks, storage = { type: 'inMemory' } } = params
	return new Project({
		configs: { default: CONFIG, other: CONFIG },
		storage,
		hooks,
	}).open(`import-${crypto.randomUUID()}`)
}

/** Import hooks whose session records when each file starts and ends, and takes `delayMs` to end. */
function recordingHooks(params: {
	events: string[]
	delayMs?: number
}): DialecteHooks<AnyDialecteConfig> {
	const { events, delayMs = 0 } = params
	return {
		createImportSession: ({ documentId }) => {
			events.push(`start ${documentId}`)
			return {
				afterImport: async () => {
					if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
					events.push(`end ${documentId}`)
					return {}
				},
			}
		},
	}
}

describe('Project.import - one entry per file', () => {
	type TestCase = BaseTestCase & {
		files: File[]
		hooks?: DialecteHooks<AnyDialecteConfig>
		options?: ImportDocumentOptions
		expectedEntries: ImportEntry[]
		/** the documents in the project state and the store after the call, by name, in order */
		expectedDocuments: string[]
		/** the config every landed document was registered under; the default when not said */
		expectedConfigKey?: string
	}

	const testCases: Record<string, TestCase> = {
		'three files, the second malformed → imported, failed (PARSE_ERROR), imported; the third landed':
			{
				files: [
					xmlFile({ body: '<A/>', name: 'one.xml' }),
					xmlFile({ body: '<A><AA_1></A>', name: 'broken.xml' }),
					xmlFile({ body: '<A/><B/>', name: 'three.xml' }),
				],
				expectedEntries: [
					imported({ fileName: 'one.xml', recordCount: 2 }),
					PARSE_FAILURE,
					imported({ fileName: 'three.xml', recordCount: 3 }),
				],
				expectedDocuments: ['one', 'three'],
			},
		'a session hook throws a plain Error → failed, IMPORT_FAILED carrying it as cause, nothing landed':
			{
				files: [xmlFile({ body: '<A/>', name: 'hook.xml' })],
				hooks: throwingHooks(HOOK_ERROR),
				expectedEntries: [HOOK_FAILURE],
				expectedDocuments: [],
			},
		"a session hook throws a dialecte's error → failed with that error, its key and meta kept": {
			files: [xmlFile({ body: '<A/>', name: 'refused.xml' })],
			hooks: throwingHooks(
				createDialecteError(HOOK_ERRORS.HOOK_REFUSED, {
					detail: 'refused by the test hook',
					meta: { why: 'test' },
				}),
			),
			expectedEntries: [HOOK_REFUSAL],
			expectedDocuments: [],
		},
		'the session has one diagnostic → imported, carrying it': {
			files: [xmlFile({ body: '<A/>', name: 'diagnosed.xml' })],
			hooks: DIAGNOSING_HOOKS,
			expectedEntries: [
				imported({
					fileName: 'diagnosed.xml',
					recordCount: 2,
					diagnostics: [UNRESOLVED_REFERENCE],
				}),
			],
			expectedDocuments: ['diagnosed'],
		},
		'a clean file, no hooks → imported, diagnostics empty': {
			files: [xmlFile({ body: '<A/>', name: 'clean.xml' })],
			expectedEntries: [imported({ fileName: 'clean.xml', recordCount: 2 })],
			expectedDocuments: ['clean'],
		},
		'no file → no entry': {
			files: [],
			expectedEntries: [],
			expectedDocuments: [],
		},
		'a configKey naming another config → imported under that key': {
			files: [xmlFile({ body: '<A/>', name: 'other.xml' })],
			options: { configKey: 'other' },
			expectedEntries: [imported({ fileName: 'other.xml', recordCount: 2 })],
			expectedDocuments: ['other'],
			expectedConfigKey: 'other',
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const project = await openProject({ hooks: testCase.hooks })
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const entries = await project.import(testCase.files, testCase.options)

			expect(entries).toStrictEqual(testCase.expectedEntries)
			for (const [index, entry] of entries.entries()) {
				const expected = testCase.expectedEntries[index]
				if (entry.status === 'failed' && expected?.status === 'failed' && expected.error.cause) {
					expect(entry.error.cause).toBe(expected.error.cause)
				}
			}

			const landed = entries.filter((entry) => entry.status === 'imported')
			expect([...project.state.documents.keys()]).toEqual(landed.map((entry) => entry.documentId))
			// the registry lists in id order, and the ids are random: the names compared as a set
			const documents = await project.getDocuments()
			expect(documents.map((stored) => stored.name).sort()).toEqual(
				[...testCase.expectedDocuments].sort(),
			)
			expect(documents.map((stored) => stored.configKey)).toEqual(
				documents.map(() => testCase.expectedConfigKey ?? 'default'),
			)

			// BroadcastChannel delivers asynchronously
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual(
				landed.map((entry) => ({
					type: 'document-imported',
					documentId: entry.documentId,
					timestamp: expect.any(Number),
				})),
			)
		} finally {
			listener.close()
			await project.close()
		}
	})
})

describe('Project.import - what is about the call rejects, before any file', () => {
	it('an unknown configKey → UNKNOWN_CONFIG_KEY naming the keys, no entry, nothing registered, no session started', async () => {
		const store = new InMemoryStore('import-config-key', { writable: true })
		const events: string[] = []
		const project = await openProject({
			hooks: recordingHooks({ events }),
			storage: { type: 'custom', store },
		})
		try {
			const importing = project.import([xmlFile({ body: '<A/>', name: 'one.xml' })], {
				configKey: 'nope',
			})
			await expect(importing).rejects.toMatchObject({
				cause: {
					key: 'UNKNOWN_CONFIG_KEY',
					detail: 'Unknown configKey: "nope". Available: default, other',
				},
			})
			const storedDocuments = await store.getDocuments()
			expect(storedDocuments).toEqual([])
			expect([...project.state.documents.keys()]).toEqual([])
			expect(events).toEqual([])
		} finally {
			await project.destroy()
		}
	})

	it('a closed project → PROJECT_NOT_OPENED, no entry', async () => {
		const project = await openProject()
		await project.close()
		await expect(
			project.import([xmlFile({ body: '<A/>', name: 'one.xml' })]),
		).rejects.toMatchObject({
			cause: { key: 'PROJECT_NOT_OPENED' },
		})
		expect([...project.state.documents.keys()]).toEqual([])
	})
})

describe('Project - one file in flight per project', () => {
	it('two importFile calls at once → the second starts once the first is in, both documents in', async () => {
		const events: string[] = []
		const project = await openProject({ hooks: recordingHooks({ events }) })
		try {
			const [one, two] = await Promise.all([
				project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' })),
				project.importFile(xmlFile({ body: '<B/>', name: 'two.xml' })),
			])
			expect(events).toEqual([
				`start ${one.documentId}`,
				`end ${one.documentId}`,
				`start ${two.documentId}`,
				`end ${two.documentId}`,
			])
			const documents = await project.getDocuments()
			expect(documents.map((stored) => stored.name).sort()).toEqual(['one', 'two'])
		} finally {
			await project.close()
		}
	})

	it('close() while an import is in flight → it lands, is in the store and broadcast once; only a call made after close rejects', async () => {
		const hooks = recordingHooks({ events: [], delayMs: 20 })
		const store = new InMemoryStore('import-close', { runtime: runtime(hooks) })
		const project = await openProject({ hooks, storage: { type: 'custom', store } })
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const importing = project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
			const closing = project.close()
			await expect(
				project.importFile(xmlFile({ body: '<A/>', name: 'two.xml' })),
			).rejects.toMatchObject({
				cause: { key: 'PROJECT_NOT_OPENED' },
			})

			const document = await importing
			await closing
			expect(document).toStrictEqual({
				fileName: 'one.xml',
				documentId: expect.any(String),
				recordCount: 2,
				diagnostics: [],
			})
			// the project closed its store: opened again to read what landed
			await store.open()
			const storedDocuments = await store.getDocuments()
			expect(storedDocuments).toEqual([
				expect.objectContaining({ id: document.documentId, name: 'one', status: 'ready' }),
			])
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual([
				{
					type: 'document-imported',
					documentId: document.documentId,
					timestamp: expect.any(Number),
				},
			])
		} finally {
			listener.close()
			await store.destroy()
		}
	})

	it('close() during an import of three files, the first in flight → it lands; the two after it are failed entries PROJECT_NOT_OPENED, nothing of them stored', async () => {
		const hooks = recordingHooks({ events: [], delayMs: 20 })
		const store = new InMemoryStore('import-close-many', { runtime: runtime(hooks) })
		const project = await openProject({ hooks, storage: { type: 'custom', store } })
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const importing = project.import([
				xmlFile({ body: '<A/>', name: 'one.xml' }),
				xmlFile({ body: '<A/>', name: 'two.xml' }),
				xmlFile({ body: '<A/>', name: 'three.xml' }),
			])
			const closing = project.close()

			const entries = await importing
			await closing
			expect(entries.map((entry) => entry.status)).toEqual(['imported', 'failed', 'failed'])
			expect(entries[0]).toStrictEqual(imported({ fileName: 'one.xml', recordCount: 2 }))
			for (const entry of entries.slice(1)) {
				expect(entry).toMatchObject({
					status: 'failed',
					error: { key: 'PROJECT_NOT_OPENED', code: 'D7003' },
				})
			}
			expect(entries.map((entry) => entry.fileName)).toEqual(['one.xml', 'two.xml', 'three.xml'])
			const landed = entries[0]?.status === 'imported' ? entries[0].documentId : ''
			// the project closed its store: opened again to read what landed
			await store.open()
			const storedDocuments = await store.getDocuments()
			expect(storedDocuments).toEqual([
				expect.objectContaining({ id: landed, name: 'one', status: 'ready' }),
			])
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual([
				{ type: 'document-imported', documentId: landed, timestamp: expect.any(Number) },
			])
		} finally {
			listener.close()
			await store.destroy()
		}
	})

	it('openDocument after close() → PROJECT_NOT_OPENED', async () => {
		const project = await openProject()
		const { documentId } = await project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
		await project.close()
		expect(() => project.openDocument(documentId)).toThrow(
			expect.objectContaining({ cause: expect.objectContaining({ key: 'PROJECT_NOT_OPENED' }) }),
		)
	})
})

describe('Project.importFile - one file, the failure thrown', () => {
	it('a clean file → the imported document, in the state, broadcast once', async () => {
		const project = await openProject()
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const document = await project.importFile(xmlFile({ body: '<A/><B/>', name: 'one.xml' }))

			expect(document).toStrictEqual({
				fileName: 'one.xml',
				documentId: expect.any(String),
				recordCount: 3,
				diagnostics: [],
			})
			expect([...project.state.documents.keys()]).toEqual([document.documentId])
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual([
				{
					type: 'document-imported',
					documentId: document.documentId,
					timestamp: expect.any(Number),
				},
			])
		} finally {
			listener.close()
			await project.close()
		}
	})

	it('a session hook throws → IMPORT_FAILED thrown, the hook’s Error as its cause, nothing landed', async () => {
		const project = await openProject({ hooks: throwingHooks(HOOK_ERROR) })
		try {
			await expect(
				project.importFile(xmlFile({ body: '<A/>', name: 'hook.xml' })),
			).rejects.toMatchObject({
				cause: { key: 'IMPORT_FAILED', cause: HOOK_ERROR },
			})
			expect([...project.state.documents.keys()]).toEqual([])
			const documents = await project.getDocuments()
			expect(documents).toEqual([])
		} finally {
			await project.close()
		}
	})

	it('a malformed file → PARSE_ERROR thrown, nothing landed', async () => {
		const project = await openProject()
		try {
			await expect(
				project.importFile(xmlFile({ body: '<A>', name: 'broken.xml' })),
			).rejects.toMatchObject({
				cause: { key: 'PARSE_ERROR', meta: { reason: 'malformed-xml' } },
			})
			const documents = await project.getDocuments()
			expect(documents).toEqual([])
		} finally {
			await project.close()
		}
	})
})

describe('Project.importFile - what the caller holds over it', () => {
	it('options.onProgress is told per batch; the document is not listed while it imports', async () => {
		const project = await openProject()
		try {
			const progress: number[] = []
			let listedWhileImporting: Promise<string[]> | undefined
			const document = await project.importFile(
				xmlFile({ body: '<A/><B/><C/>', name: 'one.xml' }),
				{
					chunkOptions: { chunkSize: 16, batchSize: 1 },
					onProgress: ({ bytesRead }) => {
						progress.push(bytesRead)
						listedWhileImporting ??= project
							.getDocuments()
							.then((documents) => documents.map((listed) => listed.id))
					},
				},
			)
			expect(progress.length).toBeGreaterThan(1)
			const listedIds = await listedWhileImporting
			expect(listedIds).toEqual([])
			const documentsAfter = await project.getDocuments()
			expect(documentsAfter.map((listed) => listed.id)).toEqual([document.documentId])
		} finally {
			await project.close()
		}
	})

	it('options.signal aborted → IMPORT_ABORTED thrown, nothing landed, nothing broadcast', async () => {
		const project = await openProject()
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const controller = new AbortController()
			await expect(
				project.importFile(xmlFile({ body: '<A/><B/><C/>', name: 'one.xml' }), {
					chunkOptions: { chunkSize: 16, batchSize: 1 },
					onProgress: () => controller.abort(),
					signal: controller.signal,
				}),
			).rejects.toMatchObject({ cause: { key: 'IMPORT_ABORTED', code: 'D5005' } })
			expect([...project.state.documents.keys()]).toEqual([])
			const documents = await project.getDocuments()
			expect(documents).toEqual([])
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual([])
		} finally {
			listener.close()
			await project.close()
		}
	})

	it('dev.perf on → the timings of the store’s import stages land on the project perf under store::', async () => {
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'inMemory' },
			dev: { perf: true },
		}).open(`import-perf-${crypto.randomUUID()}`)
		try {
			project.perf.reset()
			await project.importFile(xmlFile({ body: '<A/>', name: 'one.xml' }))
			const report = project.perf.report()
			for (const stage of ['store::import', 'store::import::insert', 'store::import::parse']) {
				expect(report[stage]?.calls, stage).toBeGreaterThan(0)
			}
			expect(Object.keys(report).filter((name) => name.startsWith('import::'))).toEqual([])
		} finally {
			project.perf.reset()
			await project.close()
		}
	})
})

describe('ImportEntry.diagnostics - an open union a consumer narrows', () => {
	it('isKnownDiagnostic narrows to the catalogue named, on source and code: the same code under another source does not match', async () => {
		const project = await openProject({ hooks: DIAGNOSING_HOOKS })
		try {
			const [entry] = await project.import([xmlFile({ body: '<A/>', name: 'diagnosed.xml' })])
			if (entry?.status !== 'imported') throw new Error('expected an imported entry')

			const known = entry.diagnostics.filter((diagnostic) =>
				isKnownDiagnostic(diagnostic, { catalogues: [IMPORT_DIAGNOSTICS] }),
			)
			expect(known).toStrictEqual([UNRESOLVED_REFERENCE])
			expect(
				entry.diagnostics.filter((diagnostic) =>
					isKnownDiagnostic(diagnostic, { catalogues: [OTHER_DIAGNOSTICS] }),
				),
			).toStrictEqual([])

			for (const diagnostic of entry.diagnostics) {
				expectTypeOf(diagnostic.code).toEqualTypeOf<string>()
				if (isKnownDiagnostic(diagnostic, { catalogues: [IMPORT_DIAGNOSTICS] })) {
					expectTypeOf(diagnostic.code).toEqualTypeOf<'unresolved-reference'>()
				}
			}
		} finally {
			await project.close()
		}
	})

	it('ImportEntry narrows on status: imported → ImportedDocument, failed → fileName and error', () => {
		const entry = imported({ fileName: 'one.xml', recordCount: 2 })
		if (entry.status === 'imported') {
			expectTypeOf(entry).toEqualTypeOf<{ status: 'imported' } & ImportedDocument>()
		} else {
			expectTypeOf(entry).toEqualTypeOf<{
				status: 'failed'
				fileName: string
				error: DialecteError
			}>()
		}
	})
})

describe('Project - a document given a path', () => {
	it('importFile at a path → the state’s document carries it, named after its file name', async () => {
		const project = await openProject()
		try {
			const { documentId } = await project.importFile(
				xmlFile({ body: '<A/>', name: 'plant.xml' }),
				{
					path: 'substations/north.xml',
				},
			)
			expect(project.state.documents.get(documentId)?.record).toMatchObject({
				path: 'substations/north.xml',
				name: 'north',
				extension: '.xml',
			})
		} finally {
			await project.close()
		}
	})

	it('import of several files takes no path: one path names one file', async () => {
		const project = await openProject()
		try {
			// @ts-expect-error a path names one file: `import` takes none
			await project.import([], { path: 'substations/north.xml' }).catch(() => undefined)
		} finally {
			await project.close()
		}
	})

	it('import of several files handed a path anyway → DOCUMENT_PATH_INVALID for the call, no file touched', async () => {
		const project = await openProject()
		try {
			const options: ImportDocumentOptions = { path: 'substations/north.xml' }
			await expect(
				project.import(
					[xmlFile({ body: '<A/>', name: 'one.xml' }), xmlFile({ body: '<A/>', name: 'two.xml' })],
					options,
				),
			).rejects.toMatchObject({
				cause: { key: 'DOCUMENT_PATH_INVALID', meta: { path: 'substations/north.xml' } },
			})
			const documents = await project.getDocuments()
			expect(documents).toEqual([])
		} finally {
			await project.close()
		}
	})

	type EmptyDocumentCase = BaseTestCase & {
		options: { path: string; name?: string; extension?: string }
		/** the document registered; none when refused */
		expected?: { name: string; extension: string }
	}

	const emptyDocumentCases: Record<string, EmptyDocumentCase> = {
		'initEmptyDocument at a path → named after its file name, the extension the path’s': {
			options: { path: 'substations/north.xml' },
			expected: { name: 'north', extension: '.xml' },
		},
		'initEmptyDocument at a path with its own extension → that extension, the name the rest': {
			options: { path: 'substations/north.icd', extension: '.icd' },
			expected: { name: 'north', extension: '.icd' },
		},
		'initEmptyDocument at a path with a name it does not end with → DOCUMENT_PATH_INVALID, nothing registered':
			{
				options: { path: 'substations/north.xml', name: 'south' },
			},
		'initEmptyDocument at a path of an extension its config does not read → DOCUMENT_PATH_INVALID, nothing registered':
			{ options: { path: 'substations/north.scd' } },
	}

	runTestCases.generic(emptyDocumentCases, async (testCase) => {
		const project = await openProject()
		try {
			const creating = project.initEmptyDocument(testCase.options)
			if (!testCase.expected) {
				await expect(creating).rejects.toMatchObject({ cause: { key: 'DOCUMENT_PATH_INVALID' } })
				const documents = await project.getDocuments()
				expect(documents).toEqual([])
				expect([...project.state.documents.keys()]).toEqual([])
				return
			}
			const documentId = await creating
			const expected = { ...testCase.expected, path: testCase.options.path }
			expect(project.state.documents.get(documentId)?.record).toMatchObject(expected)
			const stored = await project.getDocument(documentId)
			expect(stored).toMatchObject(expected)
		} finally {
			await project.close()
		}
	})
})

describe('import → read → export - an empty attribute value', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		ref:
			| Ref<TestDialecteConfig, 'BBB_1'>
			| Ref<TestDialecteConfig, 'AA_1'>
			| Ref<TestDialecteConfig, 'CC_1'>
		name: string
		/** the attribute as stored (`defaults: 'none'`), undefined when not stored */
		expectedStored: { value: string } | undefined
		/** `getAttribute` with its default view */
		expectedRead: string
		/** `getAttributes` with its default view */
		expectedAttributes: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'empty on an attribute with a default → stored empty, read empty (not the default), exported empty':
			{
				sourceXml: /* xml */ `
					<Root ${ns}>
						<B aB="b">
							<BB_1 aBB_1="bb">
								<BBB_1 ${customId}="bbb1" aBBB_1="x" bBBB_1="" />
							</BB_1>
						</B>
					</Root>
				`,
				ref: { tagName: 'BBB_1', id: 'bbb1' },
				name: 'bBBB_1',
				expectedStored: { value: '' },
				expectedRead: '',
				expectedAttributes: { aBBB_1: 'x', bBBB_1: '' },
				expectedQueries: ['//default:BBB_1[@aBBB_1="x"][@bBBB_1=""]'],
			},
		'empty on a fixed attribute → stored empty, read empty (not the fixed value), exported empty': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<C aC="c">
						<CC_1 ${customId}="cc1" aCC_1="" />
					</C>
				</Root>
			`,
			ref: { tagName: 'CC_1', id: 'cc1' },
			name: 'aCC_1',
			expectedStored: { value: '' },
			expectedRead: '',
			expectedAttributes: { aCC_1: '' },
			expectedQueries: ['//default:CC_1[@aCC_1=""]'],
			unexpectedQueries: ['//default:CC_1[@aCC_1="fixed_val"]'],
		},
		'empty on an attribute with no default → dropped on import, absent on export': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="a">
						<AA_1 ${customId}="aa1" aAA_1="x" bAA_1="" />
					</A>
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			name: 'bAA_1',
			expectedStored: undefined,
			expectedRead: '',
			expectedAttributes: { aAA_1: 'x' },
			expectedQueries: ['//default:AA_1[@aAA_1="x"]'],
			unexpectedQueries: ['//default:AA_1[@bAA_1]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const { ref, name } = testCase
		const stored = await source.query.getAttribute(ref, {
			name: name as 'bBBB_1',
			defaults: 'none',
			fullObject: true,
		})
		if (testCase.expectedStored === undefined) expect(stored).toBeUndefined()
		else expect(stored).toMatchObject(testCase.expectedStored)
		const read = await source.query.getAttribute(ref, { name: name as 'bBBB_1' })
		expect(read).toBe(testCase.expectedRead)
		const attributes = await source.query.getAttributes(ref)
		expect(attributes).toEqual(testCase.expectedAttributes)
		return {}
	}

	runTestCases.withExport({ testCases, act })
})
