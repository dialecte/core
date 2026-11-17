import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Document } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('records moved per store read', () => {
	type RecordsMoved = {
		get: number
		getMany: number
		getByTagName: number
		getByDocumentId: number
	}
	type TestCase = BaseXmlTestCase & {
		/** The one read under test, on the source document's query. */
		read: (query: Document<TestDialecteConfig>['query']) => Promise<unknown>
		expected: RecordsMoved
	}

	// five records: Root, a1 and its child aa1, a2, b1
	const sourceXml = /* xml */ `
		<Root ${customId}="root" ${ns}>
			<A ${customId}="a1" aA="v">
				<AA_1 ${customId}="aa1" aAA_1="v" />
			</A>
			<A ${customId}="a2" aA="v" />
			<B ${customId}="b1" aB="v" />
		</Root>
	`
	const none: RecordsMoved = { get: 0, getMany: 0, getByTagName: 0, getByDocumentId: 0 }

	const testCases: TestCases<TestCase> = {
		'getRecord of a stored id → one record moved by get': {
			sourceXml,
			read: (query) => query.getRecord({ tagName: 'A', id: 'a1' }),
			expected: { ...none, get: 1 },
		},
		'getRecord of an id the store does not hold → nothing moved': {
			sourceXml,
			read: (query) => query.getRecord({ tagName: 'A', id: 'missing' }),
			expected: none,
		},
		'getRecords of three ids, one missing → the two found moved by getMany': {
			sourceXml,
			read: (query) =>
				query.getRecords([
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'missing' },
					{ tagName: 'A', id: 'a2' },
				]),
			expected: { ...none, getMany: 2 },
		},
		'getRecordsByTagName → every record of the tag moved by getByTagName': {
			sourceXml,
			read: (query) => query.getRecordsByTagName('A'),
			expected: { ...none, getByTagName: 2 },
		},
		'getRecord of a ref without id → every record of its tag moved by getByTagName': {
			sourceXml,
			read: (query) => query.getRecord({ tagName: 'A' }),
			expected: { ...none, getByTagName: 2 },
		},
		'a whole-document getTree → every record of the document moved by getByDocumentId': {
			sourceXml,
			read: (query) => query.getTree({ tagName: 'Root', id: 'root' }),
			expected: { ...none, getByDocumentId: 5 },
		},
		'a getTree of depth 1 → the root by get, its three children by getMany': {
			sourceXml,
			read: (query) => query.getTree({ tagName: 'Root', id: 'root' }, { depth: 1 }),
			expected: { ...none, get: 1, getMany: 3 },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		source.perf.reset()
		await testCase.read(source.query)
		const report = source.perf.report()
		expect({
			get: report['core::store::records.get']?.count ?? 0,
			getMany: report['core::store::records.getMany']?.count ?? 0,
			getByTagName: report['core::store::records.getByTagName']?.count ?? 0,
			getByDocumentId: report['core::store::records.getByDocumentId']?.count ?? 0,
		}).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
})
