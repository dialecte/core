import { exportDocument } from './export-document'

import { describe, it, expect, vi } from 'vitest'

import { runTestCases, DIALECTE_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { DocumentRecord, ProjectState } from '../types'
import type { Store } from '@/store/store.types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NS = DIALECTE_NAMESPACES
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
		...overrides,
	}
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
})
