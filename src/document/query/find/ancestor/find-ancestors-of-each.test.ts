import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	runTestCases,
} from '@/test'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { RefOrRecord } from '@/document'
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

const xmlWithAaa2 = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
				</AAA_1>
				<AAA_2 ${customId}="aaa2" aAAA_2="abc" />
			</AA_1>
		</A>
	</Root>
`

const aaaa1 = { tagName: 'AAAA_1', id: 'aaaa1' } as const
const aaaa2 = { tagName: 'AAAA_2', id: 'aaaa2' } as const
const bbb1 = { tagName: 'BBB_1', id: 'bbb1' } as const
const aa1 = { tagName: 'AA_1', id: 'aa1' } as const

/** aaaa1 as a record that still names an earlier parent, aaa2: a record given is followed through its own `parent`. */
const aaaa1UnderAaa2 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'AAAA_1', id: 'aaaa1', parent: { tagName: 'AAA_2', id: 'aaa2' } },
})

/** A record under aaa1 that the store does not hold: answered from its own `parent`, never read. */
const givenUnderAaa1 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'AAAA_1', id: 'given', parent: { tagName: 'AAA_1', id: 'aaa1' } },
})

function tagNamesOf(lists: { tagName: string }[][]): string[][] {
	return lists.map((list) => list.map((record) => record.tagName))
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
			'a record with a stale parent and a ref of the same element → the record follows its own parent, the ref the stored one':
				{
					sourceXml: xmlWithAaa2,
					inputs: [aaaa1UnderAaa2, aaaa1],
					expected: [
						['AAA_2', 'AA_1', 'A', 'Root'],
						['AAA_1', 'AA_1', 'A', 'Root'],
					],
				},
			'depth 0 → [] at each position': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				options: { depth: 0 },
				expected: [[], []],
			},
			"stopAtTagName the input's own tag → the walk does not stop at the input": {
				sourceXml: xml,
				inputs: [aaaa1],
				options: { stopAtTagName: 'AAAA_1' },
				expected: [['AAA_1', 'AA_1', 'A', 'Root']],
			},
			'the root as input, by its tag name → []': {
				sourceXml: xml,
				inputs: [{ tagName: 'Root' }],
				expected: [[]],
			},
			'a singleton ref without id → read by its tag name, its chain': {
				sourceXml: xml,
				inputs: [{ tagName: 'BB_1' }],
				expected: [['B', 'Root']],
			},
			'order top-down with depth 2 → the two nearest ancestors, root side first': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				options: { order: 'top-down', depth: 2 },
				expected: [
					['AA_1', 'AAA_1'],
					['B', 'BB_1'],
				],
			},
			'order top-down with stopAtTagName A → each chain from its stop or the root': {
				sourceXml: xml,
				inputs: [aaaa1, bbb1],
				options: { order: 'top-down', stopAtTagName: 'A' },
				expected: [
					['A', 'AA_1', 'AAA_1'],
					['Root', 'B', 'BB_1'],
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
})
