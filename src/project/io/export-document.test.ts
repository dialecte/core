import { exportDocument } from './export-document'

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import {
	createTestProject,
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type {
	DocumentRecord,
	ProjectExportParams,
	ProjectExportResult,
	ProjectExportResultMaybeDocument,
	ProjectExportResultWithDocument,
	ProjectState,
} from '../types'
import type { Project } from '@/project'
import type { ExportFileParams, Store } from '@/store/store.types'
import type { BaseTestCase, TestDialecteConfig } from '@/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

const FORMATTED =
	'<?xml version="1.0" encoding="UTF-8"?>\r\n<Root xmlns="urn:r">\r\n    <A a="1"/>\r\n</Root>'
const COMPACT = '<?xml version="1.0" encoding="UTF-8"?><Root xmlns="urn:r"><A a="1"/></Root>'

/** A store whose export answers the formatted or compact bytes; `calls` keeps every call in order. */
function exportingStore(params: {
	calls: string[]
}): Store & { exportFile: ReturnType<typeof vi.fn> } {
	const { calls } = params
	return {
		exportFile: vi.fn(async function exportFile(exportParams: ExportFileParams) {
			const indent = exportParams.options?.indent ?? true
			const ids = exportParams.options?.withDatabaseIds ? ':ids' : ''
			calls.push(`export:${indent ? 'formatted' : 'compact'}${ids}`)
			return {
				file: new Blob([indent ? FORMATTED : COMPACT], { type: 'application/xml' }),
				filename: 'plant.scd',
			}
		}),
	} as unknown as Store & { exportFile: ReturnType<typeof vi.fn> }
}

function makeDocument(): DocumentRecord {
	return {
		id: 'doc-1',
		name: 'plant',
		extension: '.scd',
		configKey: 'default',
		createdAt: 0,
		status: 'ready',
	}
}

function stateOf(document: DocumentRecord): ProjectState {
	return {
		documents: new Map([
			[
				document.id,
				{
					record: document,
					loading: false,
					error: null,
					progress: null,
					history: [],
					lastUpdate: null,
					canUndo: false,
					canRedo: false,
				},
			],
		]),
		activeTransactions: 0,
	}
}

/**
 * A save dialog: `showSaveFilePicker` answers a handle whose writable keeps what is written; `calls` gets
 * `picker` when it opens. `outcome` makes it cancelled by the user or failing.
 */
function stubSaveDialog(params: {
	calls: string[]
	outcome?: 'cancelled' | 'lapsed' | 'failing'
}): {
	saved: () => Blob | undefined
	picker: ReturnType<typeof vi.fn>
} {
	const { calls, outcome } = params
	let written: Blob | undefined
	const picker = vi.fn(async function showSaveFilePicker() {
		calls.push('picker')
		if (outcome === 'cancelled') throw new DOMException('cancelled', 'AbortError')
		if (outcome === 'lapsed') throw new DOMException('no gesture', 'SecurityError')
		if (outcome === 'failing') throw new TypeError('no gesture')
		return {
			createWritable: async () => ({
				write: async (data: Blob) => {
					written = data
				},
				close: async () => {},
			}),
		}
	})
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
	return { saved: () => written, picker }
}

async function runExportDocument(params: {
	store: Store
	options: Omit<ProjectExportParams, 'documentId'>
}) {
	const { store, options } = params
	const document = makeDocument()
	return exportDocument({
		store,
		state: stateOf(document),
		projectName: 'project',
		request: { documentId: document.id, ...options },
	})
}

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('exportDocument', () => {
	afterEach(() => {
		delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
		vi.restoreAllMocks()
	})

	describe("answers the store's file, and what the options ask on top of it", () => {
		type OptionsCase = BaseTestCase & {
			options: Omit<ProjectExportParams, 'documentId'>
			expectedCalls: string[]
			expectedFile: string
			expectedDocument: boolean
			expectedSaved?: string
		}

		const testCases: Record<string, OptionsCase> = {
			'no option -> one formatted export, its file': {
				options: {},
				expectedCalls: ['export:formatted'],
				expectedFile: FORMATTED,
				expectedDocument: false,
			},
			'indent false -> one compact export, its file': {
				options: { indent: false },
				expectedCalls: ['export:compact'],
				expectedFile: COMPACT,
				expectedDocument: false,
			},
			'the DOM with indent false -> one compact export, parsed': {
				options: { indent: false, xmlDocument: true },
				expectedCalls: ['export:compact'],
				expectedFile: COMPACT,
				expectedDocument: true,
			},
			'the DOM with the formatted file -> a second, compact export for the DOM': {
				options: { xmlDocument: true },
				expectedCalls: ['export:formatted', 'export:compact'],
				expectedFile: FORMATTED,
				expectedDocument: true,
			},
			'a download -> the dialog opened before the export, the formatted file saved': {
				options: { download: true },
				expectedCalls: ['picker', 'export:formatted'],
				expectedFile: FORMATTED,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
			'the DOM with database ids and the formatted file -> both exports with the ids': {
				options: { xmlDocument: true, withDatabaseIds: true },
				expectedCalls: ['export:formatted:ids', 'export:compact:ids'],
				expectedFile: FORMATTED,
				expectedDocument: true,
			},
			'a download of a compact file with database ids -> both exports with the ids': {
				options: { indent: false, download: true, withDatabaseIds: true },
				expectedCalls: ['picker', 'export:compact:ids', 'export:formatted:ids'],
				expectedFile: COMPACT,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
			'a download and the DOM -> the formatted file saved, a compact export for the DOM, two in all':
				{
					options: { download: true, xmlDocument: true },
					expectedCalls: ['picker', 'export:formatted', 'export:compact'],
					expectedFile: FORMATTED,
					expectedDocument: true,
					expectedSaved: FORMATTED,
				},
			'a download and the DOM of a compact file -> a formatted export saved, two in all': {
				options: { indent: false, download: true, xmlDocument: true },
				expectedCalls: ['picker', 'export:compact', 'export:formatted'],
				expectedFile: COMPACT,
				expectedDocument: true,
				expectedSaved: FORMATTED,
			},
			'a download of a compact file -> a second, formatted export saved': {
				options: { indent: false, download: true },
				expectedCalls: ['picker', 'export:compact', 'export:formatted'],
				expectedFile: COMPACT,
				expectedDocument: false,
				expectedSaved: FORMATTED,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			const store = exportingStore({ calls })
			const result = await runExportDocument({ store, options: testCase.options })

			expect(calls).toEqual(testCase.expectedCalls)
			expect(await result.file.text()).toBe(testCase.expectedFile)
			expect(result.filename).toBe('plant.scd')
			expect('xmlDocument' in result).toBe(testCase.expectedDocument)
			if (testCase.expectedDocument) {
				expect(new XMLSerializer().serializeToString(result.xmlDocument!.documentElement)).toBe(
					COMPACT.replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
				)
			}
			expect(await dialog.saved()?.text()).toBe(testCase.expectedSaved)
		})
	})

	describe('the save dialog', () => {
		it("a download -> the dialog suggests the document filename, its extension's type", async () => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			await runExportDocument({ store: exportingStore({ calls }), options: { download: true } })
			expect(dialog.picker).toHaveBeenCalledWith({
				suggestedName: 'plant.scd',
				types: [{ description: 'SCD Files', accept: { 'application/xml': ['.scd'] } }],
			})
		})

		it("a download under another filename -> that name, the document extension's type", async () => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls })
			await runExportDocument({
				store: exportingStore({ calls }),
				options: { download: { filename: 'copy.xml' } },
			})
			expect(dialog.picker).toHaveBeenCalledWith({
				suggestedName: 'copy.xml',
				types: [{ description: 'SCD Files', accept: { 'application/xml': ['.scd'] } }],
			})
		})

		it('the dialog cancelled -> nothing saved, the file answered', async () => {
			const calls: string[] = []
			const dialog = stubSaveDialog({ calls, outcome: 'cancelled' })
			const result = await runExportDocument({
				store: exportingStore({ calls }),
				options: { download: true },
			})
			expect(dialog.saved()).toBeUndefined()
			expect(await result.file.text()).toBe(FORMATTED)
		})

		it('the dialog refused for a lapsed gesture -> the formatted file downloaded instead', async () => {
			const calls: string[] = []
			stubSaveDialog({ calls, outcome: 'lapsed' })
			const click = vi.fn()
			const anchor = document.createElement('a')
			anchor.click = click
			vi.spyOn(document, 'createElement').mockReturnValue(anchor)
			const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lapsed')
			vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
			const result = await runExportDocument({
				store: exportingStore({ calls }),
				options: { download: true },
			})
			expect(calls).toEqual(['picker', 'export:formatted'])
			expect(createObjectURL).toHaveBeenCalledWith(result.file)
			expect(anchor.download).toBe('plant.scd')
			expect(click).toHaveBeenCalled()
		})

		it('the dialog failing -> the failure thrown, nothing exported', async () => {
			const calls: string[] = []
			stubSaveDialog({ calls, outcome: 'failing' })
			const store = exportingStore({ calls })
			await expect(runExportDocument({ store, options: { download: true } })).rejects.toThrow(
				'no gesture',
			)
			expect(store.exportFile).not.toHaveBeenCalled()
		})
	})

	it('a document not in the project -> DOCUMENT_NOT_REGISTERED', async () => {
		const thrown = await exportDocument({
			store: exportingStore({ calls: [] }),
			state: { documents: new Map(), activeTransactions: 0 },
			projectName: 'project',
			request: { documentId: 'unknown' },
		}).catch((error: unknown) => error)
		expect(toDialecteError(thrown)?.key).toBe('DOCUMENT_NOT_REGISTERED')
	})
})

// ── Through a project ────────────────────────────────────────────────────────

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`

function textLeafXml(params: { text: string }): string {
	return /* xml */ `
		<Root ${ns}>
			<C aC="c">
				<CC_1 aCC_1="fixed_val">
					<CCC_1 aCCC_1="ccc">
						<CCCC_1 aCCCC_1="leaf">${params.text}</CCCC_1>
						<CCCC_2 aCCCC_2="plain" />
					</CCC_1>
				</CC_1>
			</C>
		</Root>
	`
}

/** Read the `CCCC_1` text of an exported file back, with a plain XML parser or through a project import. */
async function readLeafValue(params: {
	project: Project<TestDialecteConfig>
	text: string
	reader: 'xml parser' | 'project'
}): Promise<string | undefined> {
	const { project, text, reader } = params
	if (reader === 'xml parser') {
		const parsed = new DOMParser().parseFromString(text, 'application/xml')
		return parsed.getElementsByTagName('CCCC_1')[0]?.textContent ?? undefined
	}
	const reimported = await project.importFile(
		new File([text], 'downloaded.xml', { type: 'text/xml' }),
	)
	const [leaf] = await project
		.openDocument(reimported.documentId)
		.query.getRecordsByTagName('CCCC_1')
	return leaf?.value
}

describe('Project.export', () => {
	describe('the exported file', () => {
		type TestCase = BaseTestCase & { sourceXml: string; expectedLines: string[] }

		const cases: Record<string, TestCase> = {
			'an element with a text value -> the text stays on the element line': {
				sourceXml: textLeafXml({ text: '2025-08-04 10:59:16' }),
				expectedLines: ['                <CCCC_1 aCCCC_1="leaf">2025-08-04 10:59:16</CCCC_1>'],
			},
			'nested elements -> each child on its own line, one level deeper': {
				sourceXml: textLeafXml({ text: '2025-08-04 10:59:16' }),
				expectedLines: [
					'        <CC_1 aCC_1="fixed_val">',
					'            <CCC_1 aCCC_1="ccc">',
					'                <CCCC_2 aCCCC_2="plain"/>',
					'            </CCC_1>',
					'        </CC_1>',
				],
			},
			'an element with a text value and children -> written as is, on its line': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<C aC="c">
							<CC_1 aCC_1="fixed_val">
								<CCC_1 aCCC_1="ccc">head<CCCC_1 aCCCC_1="leaf">t</CCCC_1><CCCC_2 aCCCC_2="plain" /></CCC_1>
							</CC_1>
						</C>
					</Root>
				`,
				expectedLines: [
					'            <CCC_1 aCCC_1="ccc">head<CCCC_1 aCCCC_1="leaf">t</CCCC_1><CCCC_2 aCCCC_2="plain"/></CCC_1>',
				],
			},
			'an element with an empty text -> written empty on its line': {
				sourceXml: textLeafXml({ text: '' }),
				expectedLines: ['                <CCCC_1 aCCCC_1="leaf"/>'],
			},
		}

		runTestCases.generic(cases, async (tc) => {
			const { project, source } = await createTestProject({ sourceXml: tc.sourceXml })
			try {
				const { file } = await project.export({ documentId: source.documentId })
				const lines = (await file.text()).split('\r\n')

				for (const expectedLine of tc.expectedLines) expect(lines).toContain(expectedLine)
			} finally {
				await project.destroy()
			}
		})
	})

	describe('read again', () => {
		type ReadAgainCase = BaseTestCase & { text: string; reader: 'xml parser' | 'project' }

		const readAgainCases: Record<string, ReadAgainCase> = {
			'a text value read by an XML parser -> the same value, no whitespace added': {
				text: '2025-08-04 10:59:16',
				reader: 'xml parser',
			},
			'a text value imported again in the project -> the same value': {
				text: '2025-08-04 10:59:16',
				reader: 'project',
			},
		}

		runTestCases.generic(readAgainCases, async (tc) => {
			const { project, source } = await createTestProject({
				sourceXml: textLeafXml({ text: tc.text }),
			})
			try {
				const { file } = await project.export({ documentId: source.documentId })

				expect(await readLeafValue({ project, text: await file.text(), reader: tc.reader })).toBe(
					tc.text,
				)
			} finally {
				await project.destroy()
			}
		})
	})

	it('the result type -> the DOM typed present only when asked', () => {
		// checked by the type-check of the tests; never called
		async function typed(params: { project: Project<TestDialecteConfig>; asked: boolean }) {
			const { project, asked } = params
			const withDocument = await project.export({ documentId: 'd', xmlDocument: true })
			expectTypeOf(withDocument).toEqualTypeOf<ProjectExportResultWithDocument>()
			const withoutDocument = await project.export({ documentId: 'd' })
			expectTypeOf(withoutDocument).toEqualTypeOf<ProjectExportResult>()
			const maybeDocument = await project.export({ documentId: 'd', xmlDocument: asked })
			expectTypeOf(maybeDocument).toEqualTypeOf<ProjectExportResultMaybeDocument>()
		}
		expect(typed).toBeTypeOf('function')
	})

	it('perf on, the DOM of the formatted file -> both store exports merged into the project perf', async () => {
		const { project, source } = await createTestProject({
			sourceXml: textLeafXml({ text: 'value' }),
			dev: { perf: true },
		})
		try {
			project.perf.reset()
			await project.export({ documentId: source.documentId, xmlDocument: true })
			const report = project.perf.report()
			expect(report['store::export']?.calls).toBe(2)
			expect(report['store::export::write']?.calls).toBeGreaterThan(0)
		} finally {
			await project.destroy()
		}
	})

	it('a text value written with CRLF line ends, the DOM asked -> the value as stored, carriage returns kept', async () => {
		const { project, source } = await createTestProject({ sourceXml: textLeafXml({ text: 'old' }) })
		try {
			const [leaf] = await source.document.query.getRecordsByTagName('CCCC_1')
			await source.document.transaction(async function writeCrlfValue(tx) {
				await tx.update(leaf!, { value: 'line one\r\nline two\rend' })
			})
			const { xmlDocument } = await project.export({
				documentId: source.documentId,
				indent: false,
				xmlDocument: true,
			})
			const element = xmlDocument.getElementsByTagNameNS(
				DIALECTE_TEST_NAMESPACES.default.uri,
				'CCCC_1',
			)[0]
			expect(element?.textContent).toBe('line one\r\nline two\rend')
		} finally {
			await project.destroy()
		}
	})

	it('the DOM asked -> the document of the stored records, database ids on every element', async () => {
		const { project, source } = await createTestProject({
			sourceXml: textLeafXml({ text: 'value' }),
		})
		try {
			const { xmlDocument } = await project.export({
				documentId: source.documentId,
				indent: false,
				withDatabaseIds: true,
				xmlDocument: true,
			})
			const leaf = xmlDocument.getElementsByTagNameNS(
				DIALECTE_TEST_NAMESPACES.default.uri,
				'CCCC_1',
			)[0]
			expect(leaf?.textContent).toBe('value')
			expect(leaf?.getAttribute('_temp-idb-id')).toBeTruthy()
		} finally {
			await project.destroy()
		}
	})
})
