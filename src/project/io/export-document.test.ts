import { describe, expect, expectTypeOf, it } from 'vitest'

import {
	createTestProject,
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type {
	ProjectExportResult,
	ProjectExportResultMaybeDocument,
	ProjectExportResultWithDocument,
} from '../types'
import type { Project } from '@/project'
import type { BaseTestCase, TestDialecteConfig } from '@/test'
import type { SaveOutcome, SaveTarget } from '@/utils/save-to-disk.types'

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

				const text = await file.text()
				const value = await readLeafValue({ project, text, reader: tc.reader })
				expect(value).toBe(tc.text)
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

	it('the result type -> saved typed present exactly when a download is asked', () => {
		// checked by the type-check of the tests; never called
		async function typed(params: {
			project: Project<TestDialecteConfig>
			asked: boolean
			target: SaveTarget
		}) {
			const { project, asked, target } = params
			const saved = await project.export({ documentId: 'd', download: true })
			expectTypeOf(saved.saved).toEqualTypeOf<SaveOutcome>()
			const toTarget = await project.export({ documentId: 'd', download: { target } })
			expectTypeOf(toTarget.saved).toEqualTypeOf<SaveOutcome>()
			const withDocument = await project.export({
				documentId: 'd',
				xmlDocument: true,
				download: { filename: 'copy.scd' },
			})
			expectTypeOf(withDocument.saved).toEqualTypeOf<SaveOutcome>()
			const notSaved = await project.export({ documentId: 'd' })
			expectTypeOf(notSaved).not.toHaveProperty('saved')
			const maybeSaved = await project.export({ documentId: 'd', download: asked })
			expectTypeOf(maybeSaved.saved).toEqualTypeOf<SaveOutcome | undefined>()
			// @ts-expect-error a filename and a target together
			await project.export({ documentId: 'd', download: { filename: 'copy.scd', target } })
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
