import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	runTestCases,
} from '@/test'

import type { RefOrRecord, Transaction } from '@/document'
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

/** A record under aaa1 that the store does not hold: answered from its own `parent`, never read. */
const givenUnderAaa1 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'AAAA_1', id: 'given', parent: { tagName: 'AAA_1', id: 'aaa1' } },
})

describe('findAncestorsOfEach - inside a transaction', () => {
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
			'a parent and its child both created in the transaction → the chain through the created parent':
				{
					sourceXml: xml,
					stage: async (tx) => {
						await tx.addChild(
							{ tagName: 'AA_1', id: 'aa1' },
							{ tagName: 'AAA_2', id: '0-0-0-0-1', attributes: { aAAA_2: 'abc' } },
						)
						await tx.addChild(
							{ tagName: 'AAA_2', id: '0-0-0-0-1' },
							{ tagName: 'AAAA_1', id: '0-0-0-0-2', attributes: { aAAAA_1: 'v' } },
						)
					},
					inputs: [{ tagName: 'AAAA_1', id: '0-0-0-0-2' }],
					// created, then given its child: the latest staged operation, an update, is what a read answers
					expected: [['AAA_2:updated', 'AA_1:updated', 'A:unchanged', 'Root:unchanged']],
				},
			'a staged deletion of an ancestor → [] for an input ref under it and for a record given under it':
				{
					sourceXml: xml,
					stage: async (tx) => {
						await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
					},
					inputs: [aaaa1, givenUnderAaa1, bbb1],
					expected: [[], [], ['BB_1:unchanged', 'B:unchanged', 'Root:unchanged']],
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
