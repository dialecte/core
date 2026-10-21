import { Project } from './project'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { createDiagnostic, isKnownDiagnostic } from '@/diagnostics'
import { createDialecteError, defineErrors } from '@/errors'
import { InMemoryStore } from '@/store/in-memory/in-memory-store'
import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { ImportDocumentOptions, ImportedDocument, ImportEntry, StorageParam } from './types'
import type { Diagnostic, DiagnosticCatalogue } from '@/diagnostics'
import type { DialecteError } from '@/errors'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// Through the public Project API on an in-memory store: what `import` and `importFile` return,
// what lands, what is broadcast - one entry per file, a failing file its own entry.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const NS = CONFIG.namespaces.default.uri

function xmlFile(body: string, name: string): File {
	return new File([`<Root xmlns="${NS}">${body}</Root>`], name, { type: 'text/xml' })
}

function imported(
	fileName: string,
	recordCount: number,
	diagnostics: Diagnostic[] = [],
): ImportEntry {
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
		// the first frame that is no raising function: the `catch` in `Project.import`. What precedes
		// `/src/` is the file URL's (the dev-server port in a browser test, the package folder in node)
		method: expect.stringMatching(/^[\w-]+\/src\/project\/project::Project\.import$/),
		ref: undefined,
		meta: undefined,
		cause: HOOK_ERROR,
	},
}

async function openProject(
	hooks?: DialecteHooks<AnyDialecteConfig>,
	storage: StorageParam = { type: 'inMemory' },
) {
	return new Project({
		configs: { default: CONFIG, other: CONFIG },
		storage,
		hooks,
	}).open(`import-${crypto.randomUUID()}`)
}

/** Import hooks whose session records when each file starts and ends, and takes `delayMs` to end. */
function recordingHooks(events: string[], delayMs = 0): DialecteHooks<AnyDialecteConfig> {
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
					xmlFile('<A/>', 'one.xml'),
					xmlFile('<A><AA_1></A>', 'broken.xml'),
					xmlFile('<A/><B/>', 'three.xml'),
				],
				expectedEntries: [imported('one.xml', 2), PARSE_FAILURE, imported('three.xml', 3)],
				expectedDocuments: ['one', 'three'],
			},
		'a session hook throws a plain Error → failed, IMPORT_FAILED carrying it as cause, nothing landed':
			{
				files: [xmlFile('<A/>', 'hook.xml')],
				hooks: throwingHooks(HOOK_ERROR),
				expectedEntries: [HOOK_FAILURE],
				expectedDocuments: [],
			},
		"a session hook throws a dialecte's error → failed with that error, its key and meta kept": {
			files: [xmlFile('<A/>', 'refused.xml')],
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
			files: [xmlFile('<A/>', 'diagnosed.xml')],
			hooks: DIAGNOSING_HOOKS,
			expectedEntries: [imported('diagnosed.xml', 2, [UNRESOLVED_REFERENCE])],
			expectedDocuments: ['diagnosed'],
		},
		'a clean file, no hooks → imported, diagnostics empty': {
			files: [xmlFile('<A/>', 'clean.xml')],
			expectedEntries: [imported('clean.xml', 2)],
			expectedDocuments: ['clean'],
		},
		'no file → no entry': {
			files: [],
			expectedEntries: [],
			expectedDocuments: [],
		},
		'a configKey naming another config → imported under that key': {
			files: [xmlFile('<A/>', 'other.xml')],
			options: { configKey: 'other' },
			expectedEntries: [imported('other.xml', 2)],
			expectedDocuments: ['other'],
			expectedConfigKey: 'other',
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const project = await openProject(testCase.hooks)
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
			expect([...project.state.documents.keys()]).toEqual(landed.map((e) => e.documentId))
			const documents = await project.getDocuments()
			expect(documents.map((d) => d.name)).toEqual(testCase.expectedDocuments)
			expect(documents.map((d) => d.configKey)).toEqual(
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
		const project = await openProject(recordingHooks(events), { type: 'custom', store })
		try {
			const importing = project.import([xmlFile('<A/>', 'one.xml')], { configKey: 'nope' })
			await expect(importing).rejects.toMatchObject({
				cause: {
					key: 'UNKNOWN_CONFIG_KEY',
					detail: 'Unknown configKey: "nope". Available: default, other',
				},
			})
			expect(await store.getDocuments()).toEqual([])
			expect([...project.state.documents.keys()]).toEqual([])
			expect(events).toEqual([])
		} finally {
			await project.close()
		}
	})

	it('a closed project → PROJECT_NOT_OPENED, no entry', async () => {
		const project = await openProject()
		await project.close()
		await expect(project.import([xmlFile('<A/>', 'one.xml')])).rejects.toMatchObject({
			cause: { key: 'PROJECT_NOT_OPENED' },
		})
		expect([...project.state.documents.keys()]).toEqual([])
	})
})

describe('Project - one file in flight per project', () => {
	it('two importFile calls at once → the second starts once the first is in, both documents in', async () => {
		const events: string[] = []
		const project = await openProject(recordingHooks(events))
		try {
			const [one, two] = await Promise.all([
				project.importFile(xmlFile('<A/>', 'one.xml')),
				project.importFile(xmlFile('<B/>', 'two.xml')),
			])
			expect(events).toEqual([
				`start ${one.documentId}`,
				`end ${one.documentId}`,
				`start ${two.documentId}`,
				`end ${two.documentId}`,
			])
			expect((await project.getDocuments()).map((d) => d.name)).toEqual(['one', 'two'])
		} finally {
			await project.close()
		}
	})

	it('close() while an import is in flight → it lands, is in the store and broadcast once; only a call made after close rejects', async () => {
		const store = new InMemoryStore('import-close', { writable: true })
		const project = await openProject(recordingHooks([], 20), { type: 'custom', store })
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const importing = project.importFile(xmlFile('<A/>', 'one.xml'))
			const closing = project.close()
			await expect(project.importFile(xmlFile('<A/>', 'two.xml'))).rejects.toMatchObject({
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
			expect(await store.getDocuments()).toEqual([
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
		}
	})

	it('close() during an import of three files, the first in flight → it lands; the two after it are failed entries PROJECT_NOT_OPENED, nothing of them stored', async () => {
		const store = new InMemoryStore('import-close-many', { writable: true })
		const project = await openProject(recordingHooks([], 20), { type: 'custom', store })
		const listener = project.createChannel()
		const broadcasts: unknown[] = []
		listener.onmessage = (event) => broadcasts.push(event.data)
		try {
			const importing = project.import([
				xmlFile('<A/>', 'one.xml'),
				xmlFile('<A/>', 'two.xml'),
				xmlFile('<A/>', 'three.xml'),
			])
			const closing = project.close()

			const entries = await importing
			await closing
			expect(entries.map((entry) => entry.status)).toEqual(['imported', 'failed', 'failed'])
			expect(entries[0]).toStrictEqual(imported('one.xml', 2))
			for (const entry of entries.slice(1)) {
				expect(entry).toMatchObject({
					status: 'failed',
					error: { key: 'PROJECT_NOT_OPENED', code: 'D7003' },
				})
			}
			expect(entries.map((entry) => entry.fileName)).toEqual(['one.xml', 'two.xml', 'three.xml'])
			const landed = entries[0]?.status === 'imported' ? entries[0].documentId : ''
			expect(await store.getDocuments()).toEqual([
				expect.objectContaining({ id: landed, name: 'one', status: 'ready' }),
			])
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(broadcasts).toEqual([
				{ type: 'document-imported', documentId: landed, timestamp: expect.any(Number) },
			])
		} finally {
			listener.close()
		}
	})

	it('openDocument after close() → PROJECT_NOT_OPENED', async () => {
		const project = await openProject()
		const { documentId } = await project.importFile(xmlFile('<A/>', 'one.xml'))
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
			const document = await project.importFile(xmlFile('<A/><B/>', 'one.xml'))

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

	it('a session hook throws → the same Error object is thrown, nothing landed', async () => {
		const project = await openProject(throwingHooks(HOOK_ERROR))
		try {
			await expect(project.importFile(xmlFile('<A/>', 'hook.xml'))).rejects.toBe(HOOK_ERROR)
			expect([...project.state.documents.keys()]).toEqual([])
			expect(await project.getDocuments()).toEqual([])
		} finally {
			await project.close()
		}
	})

	it('a malformed file → PARSE_ERROR thrown, nothing landed', async () => {
		const project = await openProject()
		try {
			await expect(project.importFile(xmlFile('<A>', 'broken.xml'))).rejects.toMatchObject({
				cause: { key: 'PARSE_ERROR', meta: { reason: 'malformed-xml' } },
			})
			expect(await project.getDocuments()).toEqual([])
		} finally {
			await project.close()
		}
	})
})

describe('ImportEntry.diagnostics - an open union a consumer narrows', () => {
	it('isKnownDiagnostic narrows to the catalogue named, on source and code: the same code under another source does not match', async () => {
		const project = await openProject(DIAGNOSING_HOOKS)
		try {
			const [entry] = await project.import([xmlFile('<A/>', 'diagnosed.xml')])
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
		const entry = imported('one.xml', 2)
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
