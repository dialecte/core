import { exportDocument } from './export-document'

import { describe, it, expect, vi, afterEach } from 'vitest'

import {
	createTestProject,
	runTestCases,
	DIALECTE_TEST_NAMESPACES,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type { DocumentRecord, ProjectState } from '../types'
import type { Project } from '@/project'
import type { Store } from '@/store/store.types'
import type { BaseTestCase, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NS = DIALECTE_TEST_NAMESPACES
const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function mockStore(records: AnyRawRecord[]): Store {
	return {
		getByDocumentId: vi.fn().mockResolvedValue(records),
	} as unknown as Store
}

function record(
	overrides: Partial<AnyRawRecord> & Pick<AnyRawRecord, 'id' | 'tagName'>,
): AnyRawRecord {
	return {
		namespace: NS.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
		...overrides,
	}
}

function makeState(documentId: string, doc: DocumentRecord): ProjectState {
	return {
		documents: new Map([
			[
				documentId,
				{
					record: doc,
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

function makeDoc(overrides?: Partial<DocumentRecord>): DocumentRecord {
	return {
		id: 'doc-1',
		name: 'test-file',
		extension: '.xml',
		configKey: 'default',
		createdAt: Date.now(),
		status: 'ready',
		...overrides,
	}
}

/** Run the download path and return the text of the file it writes. */
async function downloadText(params: {
	project: Project<TestDialecteConfig>
	documentId: string
}): Promise<string> {
	const { project, documentId } = params
	let written: Blob | undefined
	const writable = {
		write: vi.fn(async (data: Blob) => {
			written = data
		}),
		close: vi.fn().mockResolvedValue(undefined),
	}
	;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
		.fn()
		.mockResolvedValue({ createWritable: () => Promise.resolve(writable) })

	await project.export(documentId, { withDownload: true })

	if (!written) throw new Error('the download wrote no file')
	return written.text()
}

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

/** Read the `CCCC_1` text of a downloaded file back, with a plain XML parser or through a project import. */
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

// ── Test Cases ───────────────────────────────────────────────────────────────

describe('exportDocument', () => {
	const configs = { default: CONFIG }

	describe('filename construction', () => {
		type TestCase = BaseTestCase & { name: string; extension: string; expected: string }

		const cases: Record<string, TestCase> = {
			'standard name + extension': {
				name: 'my-project',
				extension: '.xml',
				expected: 'my-project.xml',
			},
			'name with dots + .scd extension': {
				name: 'station.v2',
				extension: '.scd',
				expected: 'station.v2.scd',
			},
			'untitled default': {
				name: 'untitled',
				extension: '.xml',
				expected: 'untitled.xml',
			},
		}

		runTestCases.generic(cases, async (tc) => {
			const doc = makeDoc({ name: tc.name, extension: tc.extension })
			const records = [record({ id: 'r1', tagName: 'Root' })]
			const store = mockStore(records)

			const result = await exportDocument({
				documentId: doc.id,
				state: makeState(doc.id, doc),
				configs,
				store,
				projectName: 'test-project',
			})

			expect(result.filename).toBe(tc.expected)
		})
	})

	describe('XML output', () => {
		it('produces valid XMLDocument with root element', async () => {
			const doc = makeDoc()
			const records = [
				record({
					id: 'r1',
					tagName: 'Root',
					attributes: [{ name: 'version', value: '1.0' }],
				}),
			]
			const store = mockStore(records)

			const result = await exportDocument({
				documentId: doc.id,
				state: makeState(doc.id, doc),
				configs,
				store,
				projectName: 'test-project',
			})

			expect(result.xmlDocument).toBeInstanceOf(XMLDocument)
			expect(result.xmlDocument.documentElement.tagName).toBe('Root')
		})

		it('passes withDatabaseIds option to buildXmlDocument', async () => {
			const doc = makeDoc()
			const records = [record({ id: 'r1', tagName: 'Root' })]
			const store = mockStore(records)

			const result = await exportDocument({
				documentId: doc.id,
				state: makeState(doc.id, doc),
				configs,
				store,
				projectName: 'test-project',
				options: { withDatabaseIds: true },
			})

			const xml = new XMLSerializer().serializeToString(result.xmlDocument)
			expect(xml).toContain('r1')
		})
	})

	describe('error handling', () => {
		it('unregistered documentId -> throws DOCUMENT_NOT_REGISTERED', async () => {
			const store = mockStore([])
			const emptyState: ProjectState = { documents: new Map(), activeTransactions: 0 }

			await expect(
				exportDocument({
					documentId: 'unknown-id',
					state: emptyState,
					configs,
					store,
					projectName: 'test-project',
				}),
			).rejects.toThrow(/not registered/)
		})
	})

	it('fetches records by documentId from store', async () => {
		const doc = makeDoc()
		const records = [record({ id: 'r1', tagName: 'Root' })]
		const store = mockStore(records)

		await exportDocument({
			documentId: doc.id,
			state: makeState(doc.id, doc),
			configs,
			store,
			projectName: 'test-project',
		})

		expect(store.getByDocumentId).toHaveBeenCalledWith(doc.id)
	})

	describe('downloaded file', () => {
		afterEach(() => {
			delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
		})

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
				const text = await downloadText({ project, documentId: source.documentId })
				const lines = text.split(/\r?\n/)

				for (const expectedLine of tc.expectedLines) expect(lines).toContain(expectedLine)
			} finally {
				await project.destroy()
			}
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
					const text = await downloadText({ project, documentId: source.documentId })

					expect(await readLeafValue({ project, text, reader: tc.reader })).toBe(tc.text)
				} finally {
					await project.destroy()
				}
			})
		})
	})
})
