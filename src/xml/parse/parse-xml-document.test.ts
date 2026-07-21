import { parseXmlFile } from './parse-xml-document'

import { describe, expect, it, vi } from 'vitest'

import { DIALECTE_TEST_NAMESPACES, runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { AnyRawRecord, RecordPatch } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NS = DIALECTE_TEST_NAMESPACES
const CONFIG = TEST_DIALECTE_CONFIG

function createMockStore(): Store & { bulkWriteCalls: Array<Parameters<Store['bulkWrite']>> } {
	const bulkWriteCalls: Array<Parameters<Store['bulkWrite']>> = []
	return {
		name: 'test-store',
		bulkWriteCalls,
		open: vi.fn(),
		close: vi.fn(),
		destroy: vi.fn(),
		registerDocument: vi.fn(),
		getDocument: vi.fn(),
		getDocuments: vi.fn(),
		updateDocument: vi.fn(),
		removeDocument: vi.fn(),
		get: vi.fn(),
		getByDocumentId: vi.fn(),
		getByTagNameInDocument: vi.fn(),
		bulkWrite: vi.fn(async (...args: Parameters<Store['bulkWrite']>) => {
			bulkWriteCalls.push(args)
		}),
		commit: vi.fn(),
		undo: vi.fn(),
		redo: vi.fn(),
	} as unknown as Store & { bulkWriteCalls: Array<Parameters<Store['bulkWrite']>> }
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
			await parseXmlFile({ file: testCase.file, documentId: 'f1', store, config: CONFIG })
			const allRecords = store.bulkWriteCalls.flatMap(([, ops]) => ops.creates ?? [])
			testCase.assertRecords(allRecords)
		})
	})

	describe('empty and invalid files', () => {
		type TestCase = BaseTestCase & {
			file: File
			expectedResult?: { recordCount: number }
			expectError?: { key: string }
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
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()

			if (testCase.expectError) {
				await expect(
					parseXmlFile({ file: testCase.file, documentId: 'f1', store, config: CONFIG }),
				).rejects.toMatchObject({ cause: { key: testCase.expectError.key } })
			} else {
				const result = await parseXmlFile({
					file: testCase.file,
					documentId: 'f1',
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
			assertBatching: (calls: Array<Parameters<Store['bulkWrite']>>) => void
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
				store,
				config: CONFIG,
				chunkOptions: { chunkSize: testCase.chunkSize, batchSize: testCase.batchSize },
			})
			testCase.assertBatching(store.bulkWriteCalls)
		})
	})

	describe('afterImport hook', () => {
		type TestCase = BaseTestCase & {
			hookResult: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] }
			expectedRecordCount: number
			expectHookBulkWrite: boolean
		}

		const baseRecord: AnyRawRecord = {
			id: 'hook-1',
			tagName: 'A',
			namespace: NS.default,
			value: '',
			attributes: [],
			parent: null,
			children: [],
		}

		const testCases: Record<string, TestCase> = {
			'hook creates add to record count': {
				hookResult: { creates: [baseRecord] },
				expectedRecordCount: 2, // Root(1) + hook-created(1)
				expectHookBulkWrite: true,
			},
			'hook deletes subtract from record count': {
				hookResult: { deletes: ['some-id'] },
				expectedRecordCount: 0, // Root(1) - delete(1)
				expectHookBulkWrite: true,
			},
			'hook with empty ops does not call bulkWrite': {
				hookResult: {},
				expectedRecordCount: 1, // Root only
				expectHookBulkWrite: false,
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const store = createMockStore()

			const result = await parseXmlFile({
				file: xmlFile(minimalXml()),
				documentId: 'f1',
				store,
				config: CONFIG,
				hooks: { afterImport: async () => testCase.hookResult },
			})

			expect(result.recordCount).toBe(testCase.expectedRecordCount)

			if (testCase.expectHookBulkWrite) {
				// Last bulkWrite call should be from the hook
				const lastCall = store.bulkWriteCalls.at(-1)!
				expect(lastCall[0]).toBe('f1')
			}
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
					store: storeA,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
				parseXmlFile({
					file: xmlFile(xmlB, 'b.xml'),
					documentId: 'file-b',
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
					store: store1,
					config: CONFIG,
					chunkOptions: { chunkSize: 16, batchSize: 1 },
				}),
				parseXmlFile({
					file: xmlFile(xml2, 'two.xml'),
					documentId: 'same-id',
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
