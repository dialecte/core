import { runExport } from './run-export'

import { describe, expect, it } from 'vitest'

import { DIALECTE_TEST_NAMESPACES, runTestCases, TEST_DIALECTE_CONFIG } from '@/test'
import { writeXmlRecords } from '@/xml/build/write-xml-records'

import type { StoreRuntime } from './store-runtime.types'
import type { DocumentRecord } from '@/project/types'
import type { ExportFileOptions, ExportSource } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { AnyRawRecord } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG
const RUNTIME: StoreRuntime = { configs: { default: CONFIG }, defaultConfigKey: 'default' }
const DOCUMENT_ID = 'document-1'

/**
 * A store's reads over a list of records, which a case steps: `onRead` runs after every `getMany` (the
 * read's number from 1), where a case writes, removes or deletes what it needs; `calls` keeps what was read.
 */
type FakeSource = ExportSource & {
	records: Map<string, AnyRawRecord>
	document: DocumentRecord | undefined
	version: number
	calls: { getManySizes: number[]; wholeReads: number }
}

function createFakeSource(params: {
	records: AnyRawRecord[]
	onRead?: (params: { source: FakeSource; readNumber: number }) => void
}): FakeSource {
	const { onRead } = params
	const source: FakeSource = {
		records: new Map(params.records.map((record) => [record.id, record])),
		document: {
			id: DOCUMENT_ID,
			name: 'project',
			extension: '.xml',
			configKey: 'default',
			createdAt: 0,
			status: 'ready',
		},
		version: 0,
		calls: { getManySizes: [], wholeReads: 0 },
		getDocument: async function getDocument() {
			return source.document
		},
		count: async function count() {
			return source.records.size
		},
		getByTagNameInDocument: async function getByTagNameInDocument(tagName) {
			return [...source.records.values()].filter((record) => record.tagName === tagName)
		},
		getMany: async function getMany(ids) {
			source.calls.getManySizes.push(ids.length)
			const found = ids.map((id) => source.records.get(id))
			onRead?.({ source, readNumber: source.calls.getManySizes.length })
			return found
		},
		getExportVersion: async function getExportVersion() {
			return source.document?.status === 'ready' ? source.version : undefined
		},
	}
	return source
}

function record(
	overrides: Partial<AnyRawRecord> & Pick<AnyRawRecord, 'id' | 'tagName'>,
): AnyRawRecord {
	return {
		namespace: DIALECTE_TEST_NAMESPACES.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
		...overrides,
	}
}

/** A root holding `width` A elements, each holding one AA_1. */
function wideTree(params: { width: number }): AnyRawRecord[] {
	const { width } = params
	const records: AnyRawRecord[] = []
	const childRefs = []
	for (let index = 0; index < width; index++) {
		const id = `a-${index}`
		childRefs.push({ id, tagName: 'A' })
		records.push(
			record({
				id,
				tagName: 'A',
				parent: { id: 'root', tagName: 'Root' },
				attributes: [{ name: 'aA', value: String(index) }],
				children: [{ id: `aa-${index}`, tagName: 'AA_1' }],
			}),
			record({
				id: `aa-${index}`,
				tagName: 'AA_1',
				parent: { id, tagName: 'A' },
				attributes: [{ name: 'aAA_1', value: String(index) }],
			}),
		)
	}
	records.unshift(record({ id: 'root', tagName: 'Root', children: childRefs }))
	return records
}

/** A root holding `width` A elements, each the top of `depth` levels, every level `width` wide (AA_1 below A). */
function wideDeepTree(params: { width: number; depth: number }): AnyRawRecord[] {
	const records: AnyRawRecord[] = []
	const children = addLevel({
		...params,
		records,
		parent: { id: 'root', tagName: 'Root' },
		level: 1,
	})
	records.unshift(record({ id: 'root', tagName: 'Root', children }))
	return records
}

function addLevel(params: {
	width: number
	depth: number
	records: AnyRawRecord[]
	parent: { id: string; tagName: string }
	level: number
}): { id: string; tagName: string }[] {
	const { width, depth, records, parent, level } = params
	if (level > depth) return []
	const refs = []
	for (let index = 0; index < width; index++) {
		const id = `${parent.id}.${index}`
		const tagName = level === 1 ? 'A' : 'AA_1'
		refs.push({ id, tagName })
		const children = addLevel({ ...params, parent: { id, tagName }, level: level + 1 })
		records.push(record({ id, tagName, parent, attributes: [{ name: 'a', value: id }], children }))
	}
	return refs
}

async function textOf(blob: Blob): Promise<string> {
	return blob.text()
}

describe('runExport', () => {
	describe('writes the document read in batches', () => {
		type WrittenCase = BaseTestCase & { records: AnyRawRecord[]; options?: ExportFileOptions }

		const testCases: Record<string, WrittenCase> = {
			'a small document -> the bytes of its records, its name and extension': {
				records: wideTree({ width: 3 }),
			},
			'compact, with database ids -> the compact bytes': {
				records: wideTree({ width: 3 }),
				options: { indent: false, withDatabaseIds: true },
			},
			'more children than a batch -> the same bytes': {
				records: wideTree({ width: 7 }),
				options: { batchSize: 2 },
			},
			'a batch of one record -> the closing tags after the last batch written too': {
				records: wideTree({ width: 3 }),
				options: { batchSize: 1 },
			},
			'the document exactly one batch -> the same bytes': {
				records: wideTree({ width: 3 }),
				options: { batchSize: 7 },
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const source = createFakeSource({ records: testCase.records })
			const result = await runExport({
				source,
				runtime: RUNTIME,
				documentId: DOCUMENT_ID,
				options: testCase.options,
			})
			const expected = writeXmlRecords({
				records: testCase.records,
				config: CONFIG,
				indent: testCase.options?.indent,
				withDatabaseIds: testCase.options?.withDatabaseIds,
			})
			expect(await textOf(result.file)).toBe(expected)
			expect(result.file.type).toBe('application/xml')
			expect(result.filename).toBe('project.xml')
		})
	})

	describe('reads parent by parent, never the whole document', () => {
		it('a wide document in batches of 2 -> every record read once, at most 2 siblings of one parent per call', async () => {
			const records = wideTree({ width: 5 })
			const parentOf = new Map(records.map((item) => [item.id, item.parent?.id]))
			const readIds: string[][] = []
			const source = createFakeSource({ records })
			const getMany = source.getMany
			source.getMany = async function recordedGetMany(ids, documentId) {
				readIds.push(ids)
				return getMany(ids, documentId)
			}
			await runExport({
				source,
				runtime: RUNTIME,
				documentId: DOCUMENT_ID,
				options: { batchSize: 2 },
			})

			expect(readIds.flat().sort()).toEqual(
				records
					.slice(1)
					.map((item) => item.id)
					.sort(),
			)
			for (const ids of readIds) {
				expect(ids.length).toBeLessThanOrEqual(2)
				expect(new Set(ids.map((id) => parentOf.get(id))).size).toBe(1)
			}
		})
	})

	describe('holds at most one batch per open level', () => {
		it('a wide and deep document in batches of 3 -> never more than depth x 3 records read and not yet written', async () => {
			const depth = 4
			const source = createFakeSource({ records: wideDeepTree({ width: 5, depth }) })
			let read = 0
			const getMany = source.getMany
			source.getMany = async function countedGetMany(ids, documentId) {
				read += ids.length
				return getMany(ids, documentId)
			}
			const held: number[] = []
			await runExport(
				{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 3 } },
				{ onProgress: ({ recordsWritten }) => held.push(read - (recordsWritten - 1)) },
			)
			expect(Math.max(...held)).toBeLessThanOrEqual(depth * 3)
		})
	})

	describe('tells its progress per written batch', () => {
		it('7 records in batches of 2 -> told at 2, 4, 6 and 7 of 7', async () => {
			const told: unknown[] = []
			const source = createFakeSource({ records: wideTree({ width: 3 }) })
			await runExport(
				{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 2 } },
				{ onProgress: (progress) => told.push(progress) },
			)
			expect(told).toEqual([
				{ recordsWritten: 2, totalRecords: 7 },
				{ recordsWritten: 4, totalRecords: 7 },
				{ recordsWritten: 6, totalRecords: 7 },
				{ recordsWritten: 7, totalRecords: 7 },
			])
		})

		it('a listener that throws or never settles -> the export completes', async () => {
			const source = createFakeSource({ records: wideTree({ width: 3 }) })
			const throwing = await runExport(
				{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 2 } },
				{
					onProgress: () => {
						throw new Error('listener failed')
					},
				},
			)
			const pending = await runExport(
				{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 2 } },
				{ onProgress: () => new Promise(() => {}) },
			)
			expect(await textOf(throwing.file)).toBe(await textOf(pending.file))
		})
	})

	describe('a write on the document while it is exported', () => {
		/** A write as a store applies it: the attribute of a record changed, the version moved on. */
		function changeAttribute(params: { source: FakeSource; id: string; value: string }): void {
			const { source, id, value } = params
			const target = source.records.get(id)!
			source.records.set(id, {
				...target,
				attributes: [{ name: target.attributes[0]!.name, value }],
			})
			source.version++
		}

		type WriteCase = BaseTestCase & {
			/** The attribute values written, in order, after the read of that number */
			writesAtRead: Record<number, string[]>
			expected: 'restarted' | 'conflict'
		}

		const testCases: Record<string, WriteCase> = {
			'a write between two batches -> restarted, the write in the file': {
				writesAtRead: { 1: ['changed'] },
				expected: 'restarted',
			},
			'several writes in the first pass -> restarted once': {
				writesAtRead: { 1: ['first', 'changed'] },
				expected: 'restarted',
			},
			'a write after the last read -> restarted before the file is made': {
				writesAtRead: { 5: ['changed'] },
				expected: 'restarted',
			},
			'a write in each pass -> EXPORT_CONFLICT': {
				writesAtRead: { 1: ['first'], 5: ['changed'] },
				expected: 'conflict',
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const records = wideTree({ width: 3 })
			const source = createFakeSource({
				records,
				onRead: ({ source: stepped, readNumber }) => {
					for (const value of testCase.writesAtRead[readNumber] ?? []) {
						changeAttribute({ source: stepped, id: 'a-0', value })
					}
				},
			})
			const run = runExport({
				source,
				runtime: RUNTIME,
				documentId: DOCUMENT_ID,
				options: { batchSize: 2 },
			})
			if (testCase.expected === 'conflict') {
				await expect(run).rejects.toMatchObject({ cause: { key: 'EXPORT_CONFLICT' } })
				return
			}
			const written = await textOf((await run).file)
			expect(written).toBe(
				writeXmlRecords({ records: [...source.records.values()], config: CONFIG }),
			)
			expect(written).toContain('aA="changed"')
		})

		it('a subtree deleted mid-export -> restarted, never an orphan reference', async () => {
			const source = createFakeSource({
				records: wideTree({ width: 3 }),
				onRead: ({ source: stepped, readNumber }) => {
					if (readNumber !== 1) return
					// delete A a-2 and its child, as a commit does: the parent's children too
					const root = stepped.records.get('root')!
					stepped.records.set('root', {
						...root,
						children: root.children.filter((child) => child.id !== 'a-2'),
					})
					stepped.records.delete('a-2')
					stepped.records.delete('aa-2')
					stepped.version++
				},
			})
			const result = await runExport({
				source,
				runtime: RUNTIME,
				documentId: DOCUMENT_ID,
				options: { batchSize: 2 },
			})
			expect(await textOf(result.file)).not.toContain('aA="2"')
		})

		it('a subtree deleted before its chunk is read -> restarted, never an orphan reference', async () => {
			const source = createFakeSource({
				records: wideTree({ width: 3 }),
				onRead: ({ source: stepped, readNumber }) => {
					if (readNumber !== 3) return
					// a-2 deleted while the root's second chunk (holding it) is still to be read
					const root = stepped.records.get('root')!
					stepped.records.set('root', {
						...root,
						children: root.children.filter((child) => child.id !== 'a-2'),
					})
					stepped.records.delete('a-2')
					stepped.records.delete('aa-2')
					stepped.version++
				},
			})
			const result = await runExport({
				source,
				runtime: RUNTIME,
				documentId: DOCUMENT_ID,
				options: { batchSize: 2 },
			})
			expect(await textOf(result.file)).not.toContain('aA="2"')
		})

		it('the root moved away by a write before it is read -> restarted', async () => {
			const records = wideTree({ width: 2 })
			const source = createFakeSource({ records })
			const getByTagName = source.getByTagNameInDocument
			let calls = 0
			source.getByTagNameInDocument = async function movingRoot(tagName, documentId) {
				calls++
				if (calls > 1) return getByTagName(tagName, documentId)
				source.version++
				return []
			}
			const result = await runExport({ source, runtime: RUNTIME, documentId: DOCUMENT_ID })
			expect(await textOf(result.file)).toBe(writeXmlRecords({ records, config: CONFIG }))
		})

		it('the document removed mid-export -> DOCUMENT_NOT_REGISTERED', async () => {
			const source = createFakeSource({
				records: wideTree({ width: 3 }),
				onRead: ({ source: stepped }) => {
					stepped.document = undefined
					stepped.records.clear()
				},
			})
			await expect(
				runExport({ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 2 } }),
			).rejects.toMatchObject({ cause: { key: 'DOCUMENT_NOT_REGISTERED' } })
		})
	})

	it('perf on -> the timings of the export and its stages answered', async () => {
		const source = createFakeSource({ records: wideTree({ width: 3 }) })
		const result = await runExport({
			source,
			runtime: { ...RUNTIME, perf: true },
			documentId: DOCUMENT_ID,
		})
		const names = [
			...result.perf!.spans.map((span) => span.name),
			...Object.keys(result.perf!.totals),
		]
		for (const stage of ['export', 'export::read', 'export::write', 'export::assemble']) {
			expect(names.some((name) => name.endsWith(stage))).toBe(true)
		}
	})

	describe('refuses what it cannot export', () => {
		type RefusedCase = BaseTestCase & {
			arrange: (source: FakeSource) => void
			options?: ExportFileOptions
			signal?: AbortSignal
			expectedKey: string
		}

		const testCases: Record<string, RefusedCase> = {
			'a child id with no record, nothing written meanwhile -> EXPORT_ORPHAN_CHILD_REF': {
				arrange: (source) => source.records.delete('aa-1'),
				expectedKey: 'EXPORT_ORPHAN_CHILD_REF',
			},
			'no root record -> EXPORT_ROOT_NOT_FOUND': {
				arrange: (source) => source.records.delete('root'),
				expectedKey: 'EXPORT_ROOT_NOT_FOUND',
			},
			'a document not registered -> DOCUMENT_NOT_REGISTERED': {
				arrange: (source) => (source.document = undefined),
				expectedKey: 'DOCUMENT_NOT_REGISTERED',
			},
			'a document still importing -> DOCUMENT_NOT_REGISTERED': {
				arrange: (source) => (source.document = { ...source.document!, status: 'importing' }),
				expectedKey: 'DOCUMENT_NOT_REGISTERED',
			},
			'a batch size of 0 -> ASSERTION_FAILED': {
				arrange: () => {},
				options: { batchSize: 0 },
				expectedKey: 'ASSERTION_FAILED',
			},
			'a batch size that is not a whole number -> ASSERTION_FAILED': {
				arrange: () => {},
				options: { batchSize: 1.5 },
				expectedKey: 'ASSERTION_FAILED',
			},
			'aborted before it starts -> EXPORT_ABORTED': {
				arrange: () => {},
				signal: AbortSignal.abort(),
				expectedKey: 'EXPORT_ABORTED',
			},
		}

		runTestCases.generic(testCases, async (testCase) => {
			const source = createFakeSource({ records: wideTree({ width: 3 }) })
			testCase.arrange(source)
			await expect(
				runExport(
					{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: testCase.options },
					{ signal: testCase.signal },
				),
			).rejects.toMatchObject({ cause: { key: testCase.expectedKey } })
		})

		it('aborted while it runs -> EXPORT_ABORTED at the next batch', async () => {
			const controller = new AbortController()
			const source = createFakeSource({ records: wideTree({ width: 3 }) })
			await expect(
				runExport(
					{ source, runtime: RUNTIME, documentId: DOCUMENT_ID, options: { batchSize: 2 } },
					{ onProgress: () => controller.abort(), signal: controller.signal },
				),
			).rejects.toMatchObject({ cause: { key: 'EXPORT_ABORTED' } })
			expect(source.calls.getManySizes.length).toBeLessThan(4)
		})
	})
})
