import { findAncestorsOfEach } from './find-ancestors-of-each'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	closeTestContexts,
	createTestContext,
	createTestRecord,
	runTestCases,
} from '@/test'

import type { Document, RefOrRecord } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyRawRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type Input = RefOrRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
					<AAAA_2 ${customId}="aaaa2" aAAAA_2="1" />
				</AAA_1>
			</AA_1>
		</A>
		<B ${customId}="b1" aB="v">
			<BB_1 ${customId}="bb1" aBB_1="v">
				<BBB_1 ${customId}="bbb1" aBBB_1="v" />
			</BB_1>
		</B>
	</Root>
`

const aaaa1 = { tagName: 'AAAA_1', id: 'aaaa1' } as const
const aaaa2 = { tagName: 'AAAA_2', id: 'aaaa2' } as const
const bbb1 = { tagName: 'BBB_1', id: 'bbb1' } as const

/** A record under aaa1 that the store does not hold: answered from its own `parent`, never read. */
const givenUnderAaa1 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'AAAA_1', id: 'given', parent: { tagName: 'AAA_1', id: 'aaa1' } },
})

/** Root > A > 10 AA_1 > 10 AAA_1 each > 10 AAAA_1 each: 1,000 leaves, four ancestor levels above each. */
// dialecte-allow fixture-builder: 1,000 leaves cannot be written inline, and the read budget is measured on that many
function thousandLeavesXml(): string {
	let branches = ''
	for (let first = 0; first < 10; first++) {
		let middles = ''
		for (let second = 0; second < 10; second++) {
			let leaves = ''
			for (let third = 0; third < 10; third++) {
				leaves += `<AAAA_1 ${customId}="leaf-${first}-${second}-${third}" aAAAA_1="v" />`
			}
			middles += `<AAA_1 ${customId}="aaa-${first}-${second}" aAAA_1="v">${leaves}</AAA_1>`
		}
		branches += `<AA_1 ${customId}="aa-${first}" aAA_1="v${first}">${middles}</AA_1>`
	}
	return `<Root ${ns}><A ${customId}="a1" aA="v">${branches}</A></Root>`
}

const thousandLeaves: Input[] = Array.from({ length: 1000 }, function leaf(_, index) {
	const digits = String(index).padStart(3, '0').split('')
	return { tagName: 'AAAA_1', id: `leaf-${digits.join('-')}` }
})

function tagNamesOf(lists: { tagName: string }[][]): string[][] {
	return lists.map((list) => list.map((record) => record.tagName))
}

function countOf(params: { document: Document<TestDialecteConfig>; name: string }): number {
	return params.document.perf.report()[params.name]?.count ?? 0
}

describe('findAncestorsOfEach - store reads', () => {
	describe('reads each ancestor once, one store read per level', () => {
		type TestCase = BaseXmlTestCase & {
			inputs: Input[]
			expected: { reads: number; records: number }
		}

		const testCases: TestCases<TestCase> = {
			'two refs sharing four ancestors → one read for the refs, one per level, six records': {
				sourceXml: xml,
				inputs: [aaaa1, aaaa2],
				expected: { reads: 5, records: 6 },
			},
			'refs of two branches meeting at the root → the root read once': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				expected: { reads: 4, records: 8 },
			},
			'two records given → no read for them, one per level': {
				sourceXml: xml,
				inputs: [givenUnderAaa1, givenUnderAaa1],
				expected: { reads: 4, records: 4 },
			},
			'the same ref three times → read once, its ancestors once': {
				sourceXml: xml,
				inputs: [aaaa1, aaaa1, aaaa1],
				expected: { reads: 5, records: 5 },
			},
			'1,000 leaves four levels deep → depth + 1 reads, each record once': {
				sourceXml: thousandLeavesXml(),
				inputs: thousandLeaves,
				expected: { reads: 5, records: 1000 + 100 + 10 + 1 + 1 },
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			source.perf.reset()
			await source.query.findAncestorsOfEach(testCase.inputs)

			expect({
				reads: countOf({ document: source, name: 'core::store::getMany' }),
				records: countOf({ document: source, name: 'core::query::getRecord.miss' }),
			}).toEqual(testCase.expected)
		}

		runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
	})

	describe('a corrupt parent cycle', () => {
		type TestCase = BaseXmlTestCase & {
			cycle: AnyRawRecord[]
			expected: string[][]
		}

		const testCases: TestCases<TestCase> = {
			'two stored records naming each other as parent, depth 50 → the chain ends at the repeat, each record once':
				{
					sourceXml: xml,
					cycle: [
						createTestRecord({
							record: {
								tagName: 'AAA_1',
								id: 'loop-aaa',
								parent: { tagName: 'AA_1', id: 'loop-aa' },
							},
						}),
						// an AA_1 under an AAA_1: a parent no document may hold, written straight to the store
						{
							...createTestRecord({ record: { tagName: 'AA_1', id: 'loop-aa' } }),
							parent: { tagName: 'AAA_1', id: 'loop-aaa' },
						},
					],
					expected: [['AA_1', 'AAA_1']],
				},
		}

		async function act({
			project,
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const context = await createTestContext({
				databaseName: project.name,
				dialecteId: project.dialecteId,
				dialecteConfig: TEST_DIALECTE_CONFIG,
				documentId: source.documentId,
			})
			try {
				await context.store.bulkWrite(source.documentId, { creates: testCase.cycle })
				const lists = await findAncestorsOfEach({
					context,
					refsOrRecords: [{ tagName: 'AAA_1', id: 'loop-aaa' }],
					// a depth bound, so a walk without the cycle guard ends too: 50 records instead of 2
					options: { depth: 50 },
				})

				expect(tagNamesOf(lists)).toEqual(testCase.expected)
			} finally {
				await closeTestContexts()
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})
})
