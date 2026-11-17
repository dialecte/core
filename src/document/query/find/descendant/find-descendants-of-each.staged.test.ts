import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Document, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
				</AAA_1>
				<AAA_2 ${customId}="aaa2" aAAA_2="v">
					<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
				</AAA_2>
			</AA_1>
		</A>
		<B ${customId}="b1" aB="v">
			<BB_1 ${customId}="bb1" aBB_1="v">
				<BBB_1 ${customId}="bbb1" aBBB_1="v" />
			</BB_1>
		</B>
	</Root>
`

/** Two AA_1 under A, the first holding aaa1 (over aaaa1) and aaa2 (over aaaa2), the second empty: a move target. */
const twoBranchesXml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
				</AAA_1>
				<AAA_2 ${customId}="aaa2" aAAA_2="v">
					<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
				</AAA_2>
			</AA_1>
			<AA_1 ${customId}="aa2" aAA_1="v" />
		</A>
	</Root>
`

const a1 = { tagName: 'A', id: 'a1' } as const
const aa1 = { tagName: 'AA_1', id: 'aa1' } as const
const aa2 = { tagName: 'AA_1', id: 'aa2' } as const
const b1 = { tagName: 'B', id: 'b1' } as const

/** Each position's AAAA_1 then BBB_1 as `id:status`, collected inside a transaction after the staged writes. */
async function stagedAnswers(params: {
	document: Document<TestDialecteConfig>
	testCase: {
		stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
		inputs: { tagName: string; id: string }[]
		omit?: unknown[]
	}
}): Promise<string[][]> {
	const { document, testCase } = params
	const results = (await document.transaction(async (tx) => {
		await testCase.stage(tx)
		return tx.findDescendantsOfEach(
			testCase.inputs as never,
			{ collect: ['AAAA_1', 'BBB_1'], omit: testCase.omit } as never,
		)
	})) as Record<string, { id: string; status: string }[]>[]
	return results.map((groups) =>
		[...(groups.AAAA_1 ?? []), ...(groups.BBB_1 ?? [])].map(({ id, status }) => `${id}:${status}`),
	)
}

describe('findDescendantsOfEach - inside a transaction', () => {
	type TestCase = BaseXmlTestCase & {
		stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
		inputs: { tagName: string; id: string }[]
		omit?: unknown[]
		/** Each position's AAAA_1 and BBB_1, as `id:status`, in id order. */
		expected: string[][]
	}

	const testCases: TestCases<TestCase> = {
		'a record created under a scope → answered, created': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(
					{ tagName: 'AAA_1', id: 'aaa1' },
					{ tagName: 'AAAA_1', id: '0-0-0-0-1', attributes: { aAAAA_1: 'v' } },
				)
			},
			inputs: [aa1, b1],
			expected: [['0-0-0-0-1:created', 'aaaa1:unchanged', 'aaaa2:unchanged'], ['bbb1:unchanged']],
		},
		'a branch created in the transaction, parent and child → the child answered': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(
					{ tagName: 'B', id: 'b1' },
					{ tagName: 'BB_2', id: '0-0-0-0-1', attributes: { aBB_2: 'v' } },
				)
				await tx.addChild(
					{ tagName: 'BB_2', id: '0-0-0-0-1' },
					{ tagName: 'BBB_1', id: '0-0-0-0-2', attributes: { aBBB_1: 'v' } },
				)
			},
			inputs: [b1],
			expected: [['0-0-0-0-2:created', 'bbb1:unchanged']],
		},
		'a record deleted in the transaction → gone, its subtree with it': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
			},
			inputs: [a1, aa1],
			expected: [['aaaa2:unchanged'], ['aaaa2:unchanged']],
		},
		'a staged update makes a branch omitted → left out': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.update({ tagName: 'AAA_2', id: 'aaa2' }, { attributes: { aAAA_2: 'skip' } })
			},
			inputs: [a1],
			omit: [{ AAA_2: { where: { aAAA_2: 'skip' } } }],
			expected: [['aaaa1:unchanged']],
		},
		'a record moved into a scope with its subtree → answered there': {
			sourceXml: twoBranchesXml,
			stage: async (tx) => {
				await tx.move({ tagName: 'AAA_1', id: 'aaa1' }, { parent: aa2 })
			},
			inputs: [aa2],
			expected: [['aaaa1:unchanged']],
		},
		'a record moved out of a scope with its subtree → gone from it': {
			sourceXml: twoBranchesXml,
			stage: async (tx) => {
				await tx.move({ tagName: 'AAA_1', id: 'aaa1' }, { parent: aa2 })
			},
			inputs: [aa1],
			expected: [['aaaa2:unchanged']],
		},
		'a move between two scopes nested in a third → each inner scope its new subtree, the outer one both':
			{
				sourceXml: twoBranchesXml,
				stage: async (tx) => {
					await tx.move({ tagName: 'AAA_1', id: 'aaa1' }, { parent: aa2 })
				},
				inputs: [a1, aa1, aa2],
				expected: [
					['aaaa1:unchanged', 'aaaa2:unchanged'],
					['aaaa2:unchanged'],
					['aaaa1:unchanged'],
				],
			},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		await expect(stagedAnswers({ document: source, testCase })).resolves.toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})
