import { writeXmlRecords } from '../build/write-xml-records'
import { parseXmlFile } from './parse-xml-document'

import { describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type { ParseTarget } from './parse-xml-document.types'
import type { Diagnostic } from '@/diagnostics'
import type { BaseTestCase } from '@/test'
import type { AfterImportResult, AnyRawRecord, ImportSession } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NS = DIALECTE_TEST_NAMESPACES
const CONFIG = TEST_DIALECTE_CONFIG

/** A parse target recording its calls: the file's writes in `bulkWriteCalls`, the session's in `sessionWriteCalls`. */
function createMockStore(): ParseTarget & {
	bulkWriteCalls: Array<Parameters<ParseTarget['bulkWrite']>>
	sessionWriteCalls: Array<Parameters<ParseTarget['writeSession']>>
} {
	const bulkWriteCalls: Array<Parameters<ParseTarget['bulkWrite']>> = []
	const sessionWriteCalls: Array<Parameters<ParseTarget['writeSession']>> = []
	return {
		bulkWriteCalls,
		sessionWriteCalls,
		bulkWrite: vi.fn(async (...args: Parameters<ParseTarget['bulkWrite']>) => {
			bulkWriteCalls.push(args)
		}),
		writeSession: vi.fn(async (...args: Parameters<ParseTarget['writeSession']>) => {
			sessionWriteCalls.push(args)
		}),
	}
}

/** What `action` throws, `undefined` when it returns. */
function captureThrown(action: () => void): unknown {
	try {
		action()
	} catch (error) {
		return error
	}
	return undefined
}

/** A record an import session creates: `A` with no attribute, value or child. */
function sessionCreate(): AnyRawRecord {
	return {
		id: 'hook-1',
		tagName: 'A',
		namespace: NS.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
	}
}

function xmlFile(content: string, name = 'test.xml'): File {
	return new File([content], name, { type: 'application/xml' })
}

function minimalXml(body = ''): string {
	return `<Root xmlns="${NS.default.uri}">${body}</Root>`
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseXmlFile', () => {
	describe('basic parsing', () => {
		type TestCase = BaseTestCase & {
			file: File
			expectedRecordCount: number
			assertRecords?: (records: AnyRawRecord[]) => void
		}

		const testCases: Record<string, TestCase> = {
			'root-only document produces one record': {
				file: xmlFile(minimalXml()),
				expectedRecordCount: 1,
				assertRecords: (records) => {
					expect(records[0].tagName).toBe('Root')
					expect(records[0].parent).toBeNull()
				},
			},
			'root with one child produces two records': {
				file: xmlFile(minimalXml('<A aA="hello" bA="world"/>')),
				expectedRecordCount: 2,
				assertRecords: (records) => {
					const child = records.find((r) => r.tagName === 'A')
					expect(child).toBeDefined()
					expect(child!.attributes).toEqual(
						expect.arrayContaining([
							{ name: 'aA', value: 'hello' },
							{ name: 'bA', value: 'world' },
						]),
					)
				},
			},
			'nested children (3 levels)': {
				file: xmlFile(minimalXml('<A><AA_1><AAA_1/></AA_1></A>')),
				expectedRecordCount: 4,
				assertRecords: (records) => {
					const aaa = records.find((r) => r.tagName === 'AAA_1')
					expect(aaa).toBeDefined()
					expect(aaa!.parent?.tagName).toBe('AA_1')
				},
			},
			'multiple siblings at root level': {
				file: xmlFile(minimalXml('<A/><B/><C/>')),
				expectedRecordCount: 4,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			const result = await parseXmlFile({
				file: testCase.file,
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
			})

			expect(result.recordCount).toBe(testCase.expectedRecordCount)

			if (testCase.assertRecords) {
				const allRecords = store.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
				testCase.assertRecords(allRecords)
			}
		})
	})

	describe('standardization on import', () => {
		type TestCase = BaseTestCase & {
			file: File
			assertRecords: (records: AnyRawRecord[]) => void
		}

		const testCases: Record<string, TestCase> = {
			'provided attributes are reordered to schema sequence; missing ones are not filled': {
				// provided out of order and missing the required aA
				file: xmlFile(`<Root xmlns="${NS.default.uri}"><A bA="y" /></Root>`),
				assertRecords: (records) => {
					const a = records.find((r) => r.tagName === 'A')!
					// Faithful store: the omitted required aA is NOT synthesized; only bA is kept.
					expect(a.attributes.map((attr) => attr.name)).toEqual(['bA'])
				},
			},
			'xmlns declarations survive standardization on the root record': {
				file: xmlFile(
					`<Root xmlns="${NS.default.uri}" xmlns:ext="${NS.ext.uri}"><A aA="x" /></Root>`,
				),
				assertRecords: (records) => {
					const root = records.find((r) => r.tagName === 'Root')!
					const xmlnsDefault = root.attributes.find((attr) => attr.name === 'xmlns')
					const xmlnsExt = root.attributes.find(
						(attr) => attr.namespace?.prefix === 'xmlns' && attr.name === 'ext',
					)
					// Both declarations are qualified attributes and must be preserved so
					// extensions (e.g. openscd) can still resolve namespace prefixes.
					expect(xmlnsDefault?.namespace?.uri).toBe('http://www.w3.org/2000/xmlns/')
					expect(xmlnsExt?.namespace?.uri).toBe('http://www.w3.org/2000/xmlns/')
				},
			},
			'foreign-namespace element whose local name matches a schema element is not standardized': {
				// `foreign:A` shares the local name `A` with a schema element but lives in a
				// namespace the config does not declare, so it must pass through unchanged: the
				// namespace is kept and the required `aA` is NOT auto-filled.
				file: xmlFile(
					`<Root xmlns="${NS.default.uri}" xmlns:foreign="http://foreign.example/ns"><foreign:A bA="kept"/></Root>`,
				),
				assertRecords: (records) => {
					const foreign = records.find(
						(r) => r.tagName === 'A' && r.namespace?.prefix === 'foreign',
					)!
					expect(foreign).toBeDefined()
					expect(foreign.namespace?.uri).toBe('http://foreign.example/ns')
					expect(foreign.attributes).toHaveLength(1)
					expect(foreign.attributes).toContainEqual(
						expect.objectContaining({ name: 'bA', value: 'kept' }),
					)
					expect(foreign.attributes.find((attr) => attr.name === 'aA')).toBeUndefined()
				},
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			await parseXmlFile({
				file: testCase.file,
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
			})
			const allRecords = store.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
			testCase.assertRecords(allRecords)
		})
	})

	describe('text values: XML whitespace trimmed and collapsed in each run of text, every other character kept', () => {
		type TestCase = BaseTestCase & {
			/** The content of the root's first child `A` (the root's own when `ofRoot`) */
			content: string
			ofRoot?: true
			expectedValue: string
		}

		const testCases: Record<string, TestCase> = {
			'a no-break space at both ends → kept': {
				content: '\u{A0}x\u{A0}',
				expectedValue: '\u{A0}x\u{A0}',
			},
			'a leading byte order mark → kept': { content: '\u{FEFF}x', expectedValue: '\u{FEFF}x' },
			'a trailing line separator → kept': { content: 'x\u{2028}', expectedValue: 'x\u{2028}' },
			'an ideographic space and an ogham space mark → kept': {
				content: '\u{3000}x\u{1680}',
				expectedValue: '\u{3000}x\u{1680}',
			},
			'two no-break spaces inside → kept, not collapsed': {
				content: 'a\u{A0}\u{A0}b',
				expectedValue: 'a\u{A0}\u{A0}b',
			},
			'a character reference to a no-break space → kept': {
				content: '&#160;x',
				expectedValue: '\u{A0}x',
			},
			'those characters inside XML whitespace → the XML whitespace trimmed, they kept': {
				content: ' \n\t\u{FEFF}a\u{A0}b\u{2028}\r\n ',
				expectedValue: '\u{FEFF}a\u{A0}b\u{2028}',
			},
			'XML whitespace around and inside → trimmed, each inner run one space': {
				content: '  x \t\r\n y  ',
				expectedValue: 'x y',
			},
			'XML whitespace only → no value': { content: ' \r\n\t ', expectedValue: '' },
			'CDATA → as written, its whitespace kept': {
				content: '<![CDATA[  x \u{A0} ]]>',
				expectedValue: '  x \u{A0} ',
			},
			'text split by a comment → each run trimmed apart, then joined': {
				content: ' x <!-- c --> y ',
				expectedValue: 'xy',
			},
			'text around a child → each run trimmed apart, then joined': {
				content: ' x <AA_1/> y ',
				expectedValue: 'xy',
			},
			'a character reference to a tab, then text → the tab trimmed as XML whitespace': {
				content: '&#x9;x',
				expectedValue: 'x',
			},
			'indentation between elements → no value on their parent': {
				content: '\r\n    <A/>\r\n',
				ofRoot: true,
				expectedValue: '',
			},
		}

		runTestCases.generic(testCases, async function expectValue(testCase) {
			const store = createMockStore()
			const body = testCase.ofRoot ? testCase.content : `<A>${testCase.content}</A>`
			await parseXmlFile({
				file: xmlFile(minimalXml(body)),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
			})
			const records = store.bulkWriteCalls.flatMap(function createsOf([, operations]) {
				return operations.creates ?? []
			})
			const tagName = testCase.ofRoot ? 'Root' : 'A'
			const record = records.find(function isRead(candidate) {
				return candidate.tagName === tagName
			})
			expect(record?.value).toBe(testCase.expectedValue)
		})
	})

	describe('empty and invalid files', () => {
		type TestCase = BaseTestCase & {
			file: File
			expectedResult?: { recordCount: number }
			expectError?: { key: string; detailIncludes?: string }
		}

		const testCases: Record<string, TestCase> = {
			'empty file returns zero records': {
				file: xmlFile('', 'empty.xml'),
				expectedResult: { recordCount: 0 },
			},
			'unsupported extension throws invariant': {
				file: new File(['content'], 'file.txt'),
				expectError: { key: 'ASSERTION_FAILED' },
			},
			'unsupported extension .json throws invariant': {
				file: new File(['{}'], 'data.json'),
				expectError: { key: 'ASSERTION_FAILED' },
			},
			'tag not closed → PARSE_ERROR, naming what the parser saw': {
				file: xmlFile(minimalXml('<A><AA_1></A>'), 'broken.xml'),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'Unexpected close tag' },
			},
			'root never closed → PARSE_ERROR raised when the file ends': {
				file: xmlFile(`<Root xmlns="${NS.default.uri}"><A>`, 'unclosed.xml'),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'Unclosed root tag' },
			},
			'two root elements → PARSE_ERROR': {
				file: xmlFile(`${minimalXml()}<Root/>`, 'two-roots.xml'),
				expectError: { key: 'PARSE_ERROR' },
			},
			'not XML at all → PARSE_ERROR': {
				file: xmlFile('this is not xml', 'text.xml'),
				expectError: { key: 'PARSE_ERROR' },
			},
			'a reference to a vertical tab in a text value → PARSE_ERROR naming it and its element': {
				file: xmlFile(minimalXml('<A>x&#11;</A>')),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'The value of <A> holds U+000B' },
			},
			'a form feed written in a text value → PARSE_ERROR': {
				file: xmlFile(minimalXml('<A>\u{C}</A>')),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'The value of <A> holds U+000C' },
			},
			'U+FFFE in CDATA → PARSE_ERROR': {
				file: xmlFile(minimalXml('<A><![CDATA[x\u{FFFE}]]></A>')),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'The value of <A> holds U+FFFE' },
			},
			'pin: a namespace declared with a URI holding a vertical tab → PARSE_ERROR, as any attribute value':
				{
					file: xmlFile(minimalXml('<A xmlns:x="urn:&#11;" x:a="1"/>')),
					expectError: {
						key: 'PARSE_ERROR',
						detailIncludes: 'The attribute x of <A> holds U+000B',
					},
				},
			'a reference to U+0001 in an attribute value → PARSE_ERROR naming the attribute': {
				file: xmlFile(minimalXml('<A aA="&#x1;"/>')),
				expectError: { key: 'PARSE_ERROR', detailIncludes: 'The attribute aA of <A> holds U+0001' },
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()

			if (testCase.expectError) {
				await expect(
					parseXmlFile({
						file: testCase.file,
						documentId: 'f1',
						configKey: 'test',
						store,
						config: CONFIG,
					}),
				).rejects.toMatchObject({
					cause: {
						key: testCase.expectError.key,
						...(testCase.expectError.detailIncludes && {
							detail: expect.stringContaining(testCase.expectError.detailIncludes),
						}),
					},
				})
			} else {
				const result = await parseXmlFile({
					file: testCase.file,
					documentId: 'f1',
					configKey: 'test',
					store,
					config: CONFIG,
				})
				expect(result).toMatchObject(testCase.expectedResult!)
			}
		})
	})

	describe('parent-child resolution', () => {
		type TestCase = BaseTestCase & {
			xml: string
			assertRelationships: (records: AnyRawRecord[]) => void
		}

		const testCases: Record<string, TestCase> = {
			'child references parent by id and tagName': {
				xml: minimalXml('<A><AA_1/></A>'),
				assertRelationships: (records) => {
					const parent = records.find((r) => r.tagName === 'A')!
					const child = records.find((r) => r.tagName === 'AA_1')!
					expect(child.parent).toEqual({ id: parent.id, tagName: 'A' })
					expect(parent.children).toEqual(
						expect.arrayContaining([expect.objectContaining({ id: child.id, tagName: 'AA_1' })]),
					)
				},
			},
			'deeply nested parent-child chain': {
				xml: minimalXml('<A><AA_1><AAA_1><AAAA_1/></AAA_1></AA_1></A>'),
				assertRelationships: (records) => {
					const aa = records.find((r) => r.tagName === 'AA_1')!
					const aaa = records.find((r) => r.tagName === 'AAA_1')!
					const aaaa = records.find((r) => r.tagName === 'AAAA_1')!
					expect(aaa.parent).toEqual({ id: aa.id, tagName: 'AA_1' })
					expect(aaaa.parent).toEqual({ id: aaa.id, tagName: 'AAA_1' })
				},
			},
			'multiple children share same parent': {
				xml: minimalXml('<A><AA_1/><AA_2/><AA_3/></A>'),
				assertRelationships: (records) => {
					const parent = records.find((r) => r.tagName === 'A')!
					expect(parent.children).toHaveLength(3)
					const childTagNames = parent.children.map((c) => c.tagName).sort()
					expect(childTagNames).toEqual(['AA_1', 'AA_2', 'AA_3'])
				},
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			await parseXmlFile({
				file: xmlFile(testCase.xml),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
			})
			const allRecords = store.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
			testCase.assertRelationships(allRecords)
		})
	})

	describe('chunked batching', () => {
		type TestCase = BaseTestCase & {
			xml: string
			chunkSize: number
			batchSize: number
			assertBatching: (calls: Array<Parameters<ParseTarget['bulkWrite']>>) => void
		}

		const testCases: Record<string, TestCase> = {
			'small batch size triggers multiple bulkWrite calls': {
				xml: minimalXml('<A/><B/><C/>'),
				chunkSize: 16,
				batchSize: 1,
				assertBatching: (calls) => {
					// With batchSize=1, should flush frequently - expect more than 1 call
					expect(calls.length).toBeGreaterThan(1)
					const totalCreated = calls.reduce((sum, [, ops]) => sum + (ops.creates?.length ?? 0), 0)
					expect(totalCreated).toBe(4) // Root + A + B + C
				},
			},
			'large batch size uses fewer bulkWrite calls': {
				xml: minimalXml('<A/><B/><C/>'),
				chunkSize: 32 * 1024,
				batchSize: 100,
				assertBatching: (calls) => {
					// With large batch, all records fit in one flush at close
					expect(calls.length).toBe(1)
					expect(calls[0][1].creates).toHaveLength(4)
				},
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			await parseXmlFile({
				file: xmlFile(testCase.xml),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				chunkOptions: { chunkSize: testCase.chunkSize, batchSize: testCase.batchSize },
			})
			testCase.assertBatching(store.bulkWriteCalls)
		})
	})

	describe('import session', () => {
		type TestCase = BaseTestCase & {
			/** `absent`: no hooks at all; `without-factory`: hooks that declare no session factory */
			hooks?: 'absent' | 'without-factory'
			session?: ImportSession
			expectedDiagnostics: Diagnostic[]
			/** Root(1) + creates - deletes */
			expectedRecordCount: number
			/** the session's write, when it has one: through writeSession, after the parse's bulkWrite */
			expectedWrite?: Parameters<ParseTarget['writeSession']>[1]
		}

		const unresolved: Diagnostic = {
			code: 'unresolved-reference',
			severity: 'warning',
			source: 'test',
			message: 'A reference names an element the file does not hold',
			ref: { tagName: 'A', id: 'a-1', attribute: 'ref' },
		}
		const incoherent: Diagnostic = {
			code: 'incoherent-reference',
			severity: 'warning',
			source: 'test',
			message: 'A reference names one element by its path and another by its uuid',
			ref: { tagName: 'A', id: 'a-2' },
			related: [
				{ ref: { tagName: 'B', id: 'b-1' }, message: 'the element the path names' },
				{ ref: { tagName: 'B', id: 'b-2' }, message: 'the element the uuid names' },
			],
			meta: { pathValue: 'B1', uuidValue: 'b-2' },
		}
		const created: AnyRawRecord = {
			id: 'hook-1',
			tagName: 'A',
			namespace: NS.default,
			value: '',
			attributes: [],
			parent: null,
			children: [],
		}
		const patch = { recordId: 'some-id', attributes: [{ name: 'a', value: '1' }] }
		/** A session's afterImport that answers `result`. */
		function afterImport(result: AfterImportResult): () => Promise<AfterImportResult> {
			return async function answer() {
				return result
			}
		}

		const testCases: Record<string, TestCase> = {
			'session reports one diagnostic and no write → the diagnostic comes out, nothing written': {
				session: { afterImport: afterImport({ diagnostics: [unresolved] }) },
				expectedDiagnostics: [unresolved],
				expectedRecordCount: 1,
			},
			'session reports two diagnostics and a create → both come out in order, the create is written':
				{
					session: {
						afterImport: afterImport({ creates: [created], diagnostics: [unresolved, incoherent] }),
					},
					expectedDiagnostics: [unresolved, incoherent],
					expectedRecordCount: 2,
					expectedWrite: { creates: [created], updates: undefined, deletes: undefined },
				},
			'session updates a record → the patch is written, record count unchanged': {
				session: { afterImport: afterImport({ updates: [patch] }) },
				expectedDiagnostics: [],
				expectedRecordCount: 1,
				expectedWrite: { creates: undefined, updates: [patch], deletes: undefined },
			},
			'session deletes a record → record count drops, no diagnostic': {
				session: { afterImport: afterImport({ deletes: ['some-id'] }) },
				expectedDiagnostics: [],
				expectedRecordCount: 0,
				expectedWrite: { creates: undefined, updates: undefined, deletes: ['some-id'] },
			},
			'session with nothing to say → no diagnostic, nothing written': {
				session: { afterImport: afterImport({}) },
				expectedDiagnostics: [],
				expectedRecordCount: 1,
			},
			'session with a per-record hook only → no diagnostic, nothing written': {
				session: { beforeImportRecord: () => {} },
				expectedDiagnostics: [],
				expectedRecordCount: 1,
			},
			'hooks without a session factory → no diagnostic': {
				hooks: 'without-factory',
				expectedDiagnostics: [],
				expectedRecordCount: 1,
			},
			'no hooks → no diagnostic': {
				hooks: 'absent',
				expectedDiagnostics: [],
				expectedRecordCount: 1,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			const { session } = testCase
			const hooks =
				testCase.hooks === 'absent'
					? undefined
					: testCase.hooks === 'without-factory'
						? {}
						: { createImportSession: () => session! }

			const result = await parseXmlFile({
				file: xmlFile(minimalXml()),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				hooks,
			})

			expect(result.diagnostics).toStrictEqual(testCase.expectedDiagnostics)
			expect(result.recordCount).toBe(testCase.expectedRecordCount)
			// the parse writes Root in one batch; the session's write, when it has one, goes as the session's
			expect(store.bulkWriteCalls).toHaveLength(1)
			// handed with a control that hears how far the writes are
			expect(store.sessionWriteCalls).toEqual(
				testCase.expectedWrite
					? [['f1', testCase.expectedWrite, { onProgress: expect.any(Function) }]]
					: [],
			)
		})

		it('session reports a diagnostic holding a function next to a create → STORE_VALUE_NOT_JSON naming the diagnostic, the create never written', async () => {
			const store = createMockStore()
			const holdingFunction: Diagnostic = { ...unresolved, meta: { fix: function fixLater() {} } }
			const parsing = parseXmlFile({
				file: xmlFile(minimalXml()),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				hooks: {
					createImportSession: () => ({
						afterImport: afterImport({ creates: [created], diagnostics: [holdingFunction] }),
					}),
				},
			})
			const refusal = await parsing.then(
				() => undefined,
				(thrown: unknown) => toDialecteError(thrown),
			)
			expect(refusal?.key).toBe('STORE_VALUE_NOT_JSON')
			expect(refusal?.detail).toMatch(/^A diagnostic of the import session: .*field "fix"/)
			expect(store.bulkWriteCalls).toHaveLength(1)
			expect(store.sessionWriteCalls).toEqual([])
		})

		it('afterImport runs once the last record is stored', async () => {
			const store = createMockStore()
			let writesWhenCalled = -1
			await parseXmlFile({
				file: xmlFile(minimalXml('<A/>')),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				chunkOptions: { chunkSize: 16, batchSize: 1 },
				hooks: {
					createImportSession: () => ({
						afterImport: async () => {
							writesWhenCalled = store.bulkWriteCalls.length
							return {}
						},
					}),
				},
			})
			const recordsWritten = store.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? []).length
			expect(recordsWritten).toBe(2)
			expect(writesWhenCalled).toBe(store.bulkWriteCalls.length)
		})

		it('empty file → no diagnostic, no session created', async () => {
			const createImportSession = vi.fn((): ImportSession => ({}))
			const result = await parseXmlFile({
				file: xmlFile(''),
				documentId: 'f1',
				configKey: 'test',
				store: createMockStore(),
				config: CONFIG,
				hooks: { createImportSession },
			})
			expect(result).toEqual({ documentId: 'f1', recordCount: 0, diagnostics: [] })
			expect(createImportSession).not.toHaveBeenCalled()
		})

		it('one file → one session, created with the documentId and the configKey', async () => {
			const createImportSession = vi.fn((): ImportSession => ({}))
			await parseXmlFile({
				file: xmlFile(minimalXml('<A/>')),
				documentId: 'doc-1',
				configKey: 'cfg',
				store: createMockStore(),
				config: CONFIG,
				hooks: { createImportSession },
			})
			expect(createImportSession).toHaveBeenCalledTimes(1)
			expect(createImportSession).toHaveBeenCalledWith({ documentId: 'doc-1', configKey: 'cfg' })
		})

		it('two files one after the other → two sessions, each sees only its own records', async () => {
			const seen: Record<string, string[]> = {}
			const hooks = {
				createImportSession: ({ documentId }: { documentId: string }): ImportSession => {
					seen[documentId] = []
					return {
						beforeImportRecord: ({ record }) => seen[documentId]!.push(record.tagName),
					}
				},
			}
			function parse(documentId: string, body: string): ReturnType<typeof parseXmlFile> {
				return parseXmlFile({
					file: xmlFile(minimalXml(body)),
					documentId,
					configKey: 'test',
					store: createMockStore(),
					config: CONFIG,
					hooks,
				})
			}

			await parse('first', '<A><AA_1/></A>')
			await parse('second', '<B/>')

			expect(seen).toEqual({ first: ['AA_1', 'A', 'Root'], second: ['B', 'Root'] })
		})
	})

	it('a record id read from the file (custom ids) holding a vertical tab → PARSE_ERROR naming it', async function refusesCustomId() {
		const store = createMockStore()
		const file = xmlFile(
			`<Root xmlns="${NS.default.uri}" ${XMLNS_DEV_NAMESPACE}><A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a&#11;"/></Root>`,
		)
		await expect(
			parseXmlFile({
				file,
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				useCustomRecordsIds: true,
			}),
		).rejects.toMatchObject({
			cause: {
				key: 'PARSE_ERROR',
				detail: expect.stringContaining(
					`The attribute ${CUSTOM_RECORD_ID_ATTRIBUTE} of <A> holds U+000B`,
				),
			},
		})
		expect(store.bulkWriteCalls).toHaveLength(0)
	})

	describe('import session writes holding a character XML does not allow', () => {
		type TestCase = BaseTestCase & {
			session: ImportSession
			expectedKey: string
			expectedMeta: Record<string, unknown>
			/** The store writes made: the parse's batch only (1), or none when the parse fails (0) */
			expectedWriteCount: number
		}

		const testCases: Record<string, TestCase> = {
			'a create whose value holds a vertical tab → XML_CHARACTER_NOT_ALLOWED, never written': {
				session: {
					afterImport: async function createsControl() {
						return {
							creates: [
								{
									id: 'hook-1',
									tagName: 'A',
									namespace: NS.default,
									value: 'x\u{B}',
									attributes: [],
									parent: null,
									children: [],
								},
							],
						}
					},
				},
				expectedKey: 'XML_CHARACTER_NOT_ALLOWED',
				expectedMeta: { recordId: 'hook-1', tagName: 'A', part: 'value', character: 'U+000B' },
				expectedWriteCount: 1,
			},
			'a create whose tag name holds a vertical tab → refused, naming the tag name': {
				session: {
					afterImport: async function createsBadTagName() {
						return { creates: [{ ...sessionCreate(), tagName: 'A\u{B}' }] }
					},
				},
				expectedKey: 'XML_CHARACTER_NOT_ALLOWED',
				expectedMeta: { recordId: 'hook-1', tagName: 'A\u{B}', part: 'name', character: 'U+000B' },
				expectedWriteCount: 1,
			},
			'a create whose namespace prefix holds a vertical tab → refused, naming the prefix': {
				session: {
					afterImport: async function createsBadPrefix() {
						return {
							creates: [{ ...sessionCreate(), namespace: { prefix: 'x\u{B}', uri: 'urn:x' } }],
						}
					},
				},
				expectedKey: 'XML_CHARACTER_NOT_ALLOWED',
				expectedMeta: { recordId: 'hook-1', tagName: 'A', part: 'prefix', character: 'U+000B' },
				expectedWriteCount: 1,
			},
			'a patch whose attribute name holds a vertical tab → refused, naming the name': {
				session: {
					afterImport: async function patchesBadName() {
						return {
							updates: [{ recordId: 'some-id', attributes: [{ name: 'a\u{B}', value: '1' }] }],
						}
					},
				},
				expectedKey: 'XML_CHARACTER_NOT_ALLOWED',
				expectedMeta: {
					recordId: 'some-id',
					attribute: 'a\u{B}',
					part: 'name',
					character: 'U+000B',
				},
				expectedWriteCount: 1,
			},
			'a patch whose attribute value holds a form feed → refused, naming the attribute': {
				session: {
					afterImport: async function patchesControl() {
						return {
							updates: [{ recordId: 'some-id', attributes: [{ name: 'a', value: '\u{C}' }] }],
						}
					},
				},
				expectedKey: 'XML_CHARACTER_NOT_ALLOWED',
				expectedMeta: { recordId: 'some-id', attribute: 'a', part: 'value', character: 'U+000C' },
				expectedWriteCount: 1,
			},
			'a per-record hook giving a record a namespace whose URI holds a vertical tab → PARSE_ERROR':
				{
					session: {
						beforeImportRecord: function namespacesControl({ record }) {
							record.namespace = { prefix: 'x', uri: 'urn:\u{B}' }
						},
					},
					expectedKey: 'PARSE_ERROR',
					expectedMeta: { reason: 'not-xml-character', character: 'U+000B' },
					expectedWriteCount: 0,
				},
			'a per-record hook writing U+FFFF into a value → PARSE_ERROR, as if the file held it': {
				session: {
					beforeImportRecord: function writesControl({ record }) {
						record.value = '\u{FFFF}'
					},
				},
				expectedKey: 'PARSE_ERROR',
				expectedMeta: { reason: 'not-xml-character', character: 'U+FFFF' },
				expectedWriteCount: 0,
			},
		}

		runTestCases.generic(testCases, async function expectRefused(testCase) {
			const store = createMockStore()
			const hooks = {
				createImportSession: function sessionOf() {
					return testCase.session
				},
			}
			const thrown = await parseXmlFile({
				file: xmlFile(minimalXml()),
				documentId: 'f1',
				configKey: 'test',
				store,
				config: CONFIG,
				hooks,
			}).then(
				function imported() {
					return undefined
				},
				function refused(error: unknown) {
					return error
				},
			)
			const error = toDialecteError(thrown)
			expect(error?.key).toBe(testCase.expectedKey)
			expect(error?.meta).toEqual(testCase.expectedMeta)
			// the parse's own batch, or none when the parse fails; never a session write
			expect(store.bulkWriteCalls).toHaveLength(testCase.expectedWriteCount)
			expect(store.sessionWriteCalls).toEqual([])
		})
	})

	it('a name a per-record hook gives a record holding a vertical tab → imported, its export refused by the writer', async function splitsNameCheck() {
		const store = createMockStore()
		const hooks = {
			createImportSession: function sessionOf() {
				return {
					beforeImportRecord: function namesControl({ record }: { record: AnyRawRecord }) {
						if (record.tagName === 'A') record.attributes.push({ name: 'b\u{B}', value: '1' })
					},
				}
			},
		}
		const result = await parseXmlFile({
			file: xmlFile(minimalXml('<A aA="1"/>')),
			documentId: 'f1',
			configKey: 'test',
			store,
			config: CONFIG,
			hooks,
		})
		expect(result.recordCount).toBe(2)
		const records = store.bulkWriteCalls.flatMap(function createsOf([, operations]) {
			return operations.creates ?? []
		})
		const thrown = captureThrown(function writeImported() {
			writeXmlRecords({ records, config: CONFIG })
		})
		expect(toDialecteError(thrown)?.key).toBe('XML_CHARACTER_NOT_ALLOWED')
		expect(toDialecteError(thrown)?.meta).toMatchObject({
			tagName: 'A',
			attribute: 'b\u{B}',
			part: 'name',
		})
	})

	describe('documentId propagation', () => {
		type TestCase = BaseTestCase & {
			documentId: string
		}

		const testCases: Record<string, TestCase> = {
			'documentId passed to bulkWrite': { documentId: 'my-file-id' },
			'different documentId passed correctly': { documentId: 'another-id' },
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()
			const result = await parseXmlFile({
				file: xmlFile(minimalXml()),
				documentId: testCase.documentId,
				configKey: 'test',
				store,
				config: CONFIG,
			})

			expect(result.documentId).toBe(testCase.documentId)
			store.bulkWriteCalls.forEach(([fid]) => {
				expect(fid).toBe(testCase.documentId)
			})
		})
	})

	describe('parallel import isolation', () => {
		it('concurrent imports do not share state', async () => {
			const storeA = createMockStore()
			const storeB = createMockStore()

			// File A: deep nesting forces cross-batch relationship resolution
			const xmlA = minimalXml('<A><AA_1><AAA_1/></AA_1></A>')
			// File B: different structure
			const xmlB = minimalXml('<B><BB_1/><BB_2/></B>')

			const [resultA, resultB] = await Promise.all([
				parseXmlFile({
					file: xmlFile(xmlA, 'a.xml'),
					documentId: 'file-a',
					configKey: 'test',
					store: storeA,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
				parseXmlFile({
					file: xmlFile(xmlB, 'b.xml'),
					documentId: 'file-b',
					configKey: 'test',
					store: storeB,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
			])

			expect(resultA.recordCount).toBe(4) // Root + A + AA_1 + AAA_1
			expect(resultB.recordCount).toBe(4) // Root + B + BB_1 + BB_2

			const recordsA = storeA.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
			const recordsB = storeB.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])

			// No tag from B leaks into A
			expect(recordsA.map((r) => r.tagName)).not.toContain('B')
			expect(recordsA.map((r) => r.tagName)).not.toContain('BB_1')
			// No tag from A leaks into B
			expect(recordsB.map((r) => r.tagName)).not.toContain('A')
			expect(recordsB.map((r) => r.tagName)).not.toContain('AA_1')

			// Relationships resolved correctly for A
			const aa1 = recordsA.find((r) => r.tagName === 'AA_1')!
			const aaa1 = recordsA.find((r) => r.tagName === 'AAA_1')!
			expect(aaa1.parent).toEqual({ id: aa1.id, tagName: 'AA_1' })
			expect(aa1.children).toEqual(
				expect.arrayContaining([expect.objectContaining({ tagName: 'AAA_1' })]),
			)

			// Relationships resolved correctly for B
			const b = recordsB.find((r) => r.tagName === 'B')!
			expect(b.children).toHaveLength(2)
			expect(b.children.map((c) => c.tagName).sort()).toEqual(['BB_1', 'BB_2'])
		})

		it('shared documentId with separate stores stays isolated', async () => {
			const store1 = createMockStore()
			const store2 = createMockStore()

			const xml1 = minimalXml('<X/>')
			const xml2 = minimalXml('<Y/>')

			await Promise.all([
				parseXmlFile({
					file: xmlFile(xml1, 'one.xml'),
					documentId: 'same-id',
					configKey: 'test',
					store: store1,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
				parseXmlFile({
					file: xmlFile(xml2, 'two.xml'),
					documentId: 'same-id',
					configKey: 'test',
					store: store2,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
			])

			const records1 = store1.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
			const records2 = store2.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])

			expect(records1.map((r) => r.tagName)).toContain('X')
			expect(records1.map((r) => r.tagName)).not.toContain('Y')
			expect(records2.map((r) => r.tagName)).toContain('Y')
			expect(records2.map((r) => r.tagName)).not.toContain('X')
		})
	})
})
