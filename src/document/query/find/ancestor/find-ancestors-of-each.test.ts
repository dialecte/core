import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	runTestCases,
} from '@/test'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { Document, RefOrRecord, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

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
const aa1 = { tagName: 'AA_1', id: 'aa1' } as const

/** A record under aaa1 that the store does not hold: answered from its own `parent`, never read. */
const givenUnderAaa1 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'AAAA_1', id: 'given', parent: { tagName: 'AAA_1', id: 'aaa1' } },
})

/** Root > A > 10 AA_1 > 10 AAA_1 each > 10 AAAA_1 each: 1,000 leaves, four ancestor levels above each. */
function thousandLeavesXml(): string {
	const tens = Array.from({ length: 10 }, (_, index) => index)
	const branches = tens.map(function aa(first) {
		const middles = tens.map(function aaa(second) {
			const leaves = tens.map(function aaaa(third) {
				return `<AAAA_1 ${customId}="leaf-${first}-${second}-${third}" aAAAA_1="v" />`
			})
			return `<AAA_1 ${customId}="aaa-${first}-${second}" aAAA_1="v">${leaves.join('')}</AAA_1>`
		})
		return `<AA_1 ${customId}="aa-${first}" aAA_1="v${first}">${middles.join('')}</AA_1>`
	})
	return `<Root ${ns}><A ${customId}="a1" aA="v">${branches.join('')}</A></Root>`
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

describe('findAncestorsOfEach', () => {
	describe('answers each position', () => {
		type TestCase = BaseXmlTestCase & {
			inputs: Input[]
			options?: FindAncestorsOptions<TestDialecteConfig>
			expected: string[][]
		}

		const testCases: TestCases<TestCase> = {
			'two leaves sharing ancestors → each full chain bottom-up': {
				sourceXml: xml,
				inputs: [aaaa1, aaaa2],
				expected: [
					['AAA_1', 'AA_1', 'A', 'Root'],
					['AAA_1', 'AA_1', 'A', 'Root'],
				],
			},
			'leaves of two branches, order top-down → each chain from the root': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				options: { order: 'top-down' },
				expected: [
					['Root', 'A', 'AA_1', 'AAA_1'],
					['Root', 'B', 'BB_1'],
				],
			},
			'depth 2 → at most two ancestors per element': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1, aa1],
				options: { depth: 2 },
				expected: [
					['AAA_1', 'AA_1'],
					['BB_1', 'B'],
					['A', 'Root'],
				],
			},
			'stopAtTagName A → chains through A stop there (inclusive), the others reach the root': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				options: { stopAtTagName: 'A' },
				expected: [
					['AAA_1', 'AA_1', 'A'],
					['BB_1', 'B', 'Root'],
				],
			},
			'a record the store does not hold, beside a ref → the record answered from its parent': {
				sourceXml: xml,
				inputs: [givenUnderAaa1, bbb1],
				expected: [
					['AAA_1', 'AA_1', 'A', 'Root'],
					['BB_1', 'B', 'Root'],
				],
			},
			'the same ref three times → the same chain at each position': {
				sourceXml: xml,
				inputs: [bbb1, bbb1, bbb1],
				expected: [
					['BB_1', 'B', 'Root'],
					['BB_1', 'B', 'Root'],
					['BB_1', 'B', 'Root'],
				],
			},
			'an unknown ref between two known ones → [] at its position': {
				sourceXml: xml,
				inputs: [aa1, { tagName: 'BBB_1', id: 'missing' }, bbb1],
				expected: [['A', 'Root'], [], ['BB_1', 'B', 'Root']],
			},
			'one element is an ancestor of another → both chains': {
				sourceXml: xml,
				inputs: [aaaa1, aa1],
				expected: [
					['AAA_1', 'AA_1', 'A', 'Root'],
					['A', 'Root'],
				],
			},
			'no element → no list': {
				sourceXml: xml,
				inputs: [],
				expected: [],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const lists = await source.query.findAncestorsOfEach(testCase.inputs, testCase.options)

			expect(tagNamesOf(lists)).toEqual(testCase.expected)
		}

		runTestCases.withoutExport({ testCases, act })
	})

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

	describe('each list holds its own records', () => {
		type TestCase = BaseXmlTestCase & {
			inputs: Input[]
		}

		const testCases: TestCases<TestCase> = {
			'two leaves sharing every ancestor → equal records, no object in both lists': {
				sourceXml: xml,
				inputs: [aaaa1, aaaa2],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const [first, second] = await source.query.findAncestorsOfEach(testCase.inputs)

			expect(second).toEqual(first)
			expect(first.filter((record) => second.includes(record))).toEqual([])
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('inside a transaction, the staged records answer', () => {
		type TestCase = BaseXmlTestCase & {
			stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
			inputs: Input[]
			expected: string[][]
		}

		const testCases: TestCases<TestCase> = {
			'a staged update of a shared parent → that parent updated at each position': {
				sourceXml: xml,
				stage: async (tx) => {
					await tx.update({ tagName: 'AAA_1', id: 'aaa1' }, { attributes: { aAAA_1: 'new' } })
				},
				inputs: [aaaa1, aaaa2],
				expected: [
					['AAA_1:updated', 'AA_1:unchanged', 'A:unchanged', 'Root:unchanged'],
					['AAA_1:updated', 'AA_1:unchanged', 'A:unchanged', 'Root:unchanged'],
				],
			},
			'a staged created child → its chain from its stored parent': {
				sourceXml: xml,
				stage: async (tx) => {
					await tx.addChild(
						{ tagName: 'BB_1', id: 'bb1' },
						{ tagName: 'BBB_2', id: '0-0-0-0-1', attributes: { aBBB_2: 'v' } },
					)
				},
				inputs: [{ tagName: 'BBB_2', id: '0-0-0-0-1' }],
				expected: [['BB_1:updated', 'B:unchanged', 'Root:unchanged']],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const lists = await source.transaction(async (tx) => {
				await testCase.stage(tx)
				return tx.findAncestorsOfEach(testCase.inputs)
			})

			expect(
				lists.map((list) => list.map((record) => `${record.tagName}:${record.status}`)),
			).toEqual(testCase.expected)
		}

		runTestCases.withoutExport({ testCases, act })
	})
})
