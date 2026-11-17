import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
} from '@/test'

import type { AnyRefOrRecord, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** AA_1 is transparent: its children are looked up from its parent when the parent has none of the tag. */
const TRANSPARENT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	transparentElements: ['AA_1'] as const,
} as unknown as TestDialecteConfig

const transparentRunner = createTestRunner({ dialecteConfig: TRANSPARENT_CONFIG })

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_2 ${customId}="aa1" aAA_2="v" />
			<AA_2 ${customId}="aa2" aAA_2="v" />
		</A>
		<A ${customId}="a2" aA="v">
			<AA_1 ${customId}="w1" aAA_1="v">
				<AAA_1 ${customId}="x1" aAAA_1="v" />
			</AA_1>
		</A>
		<A ${customId}="a3" aA="v" />
	</Root>
`

const a1 = { tagName: 'A', id: 'a1' } as const
const a2 = { tagName: 'A', id: 'a2' } as const
const a3 = { tagName: 'A', id: 'a3' } as const

describe('getChildrenOfEach - inside a transaction, the staged records answer', () => {
	type TestCase = BaseXmlTestCase & {
		stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
		inputs: AnyRefOrRecord[]
		tagName: string
		expected: string[][]
	}

	const testCases: TestCases<TestCase> = {
		'a staged created child → answered under its parent': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(a3, { tagName: 'AA_2', id: '0-0-0-0-1', attributes: { aAA_2: 'v' } })
			},
			inputs: [a1, a3],
			tagName: 'AA_2',
			expected: [['aa1:unchanged', 'aa2:unchanged'], ['0-0-0-0-1:created']],
		},
		'a staged deleted child → left out': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_2', id: 'aa1' })
			},
			inputs: [a1, a1],
			tagName: 'AA_2',
			expected: [['aa2:unchanged'], ['aa2:unchanged']],
		},
		'a staged updated child → its staged version': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.update({ tagName: 'AA_2', id: 'aa2' }, { attributes: { aAA_2: 'new' } })
			},
			inputs: [a1],
			tagName: 'AA_2',
			expected: [['aa1:unchanged', 'aa2:updated']],
		},
		'a staged child created inside a wrapper → found through the wrapper': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(
					{ tagName: 'AA_1', id: 'w1' },
					{ tagName: 'AAA_1', id: '0-0-0-0-2', attributes: { aAAA_1: 'v' } },
				)
			},
			inputs: [a2],
			tagName: 'AAA_1',
			expected: [['x1:unchanged', '0-0-0-0-2:created']],
		},
		'a staged wrapper and its child, both created → found through the created wrapper': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(a3, { tagName: 'AA_1', id: '0-0-0-0-3', attributes: { aAA_1: 'v' } })
				await tx.addChild(
					{ tagName: 'AA_1', id: '0-0-0-0-3' },
					{ tagName: 'AAA_1', id: '0-0-0-0-4', attributes: { aAAA_1: 'v' } },
				)
			},
			inputs: [a3],
			tagName: 'AAA_1',
			expected: [['0-0-0-0-4:created']],
		},
		'a staged deleted wrapper → nothing found through it': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_1', id: 'w1' })
			},
			inputs: [a2],
			tagName: 'AAA_1',
			expected: [[]],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const lists = await source.transaction(async (tx) => {
			await testCase.stage(tx)
			return tx.any.getChildrenOfEach(testCase.inputs, { tagName: testCase.tagName })
		})

		expect(lists.map((list) => list.map((record) => `${record.id}:${record.status}`))).toEqual(
			testCase.expected,
		)
	}

	transparentRunner.withoutExport({ testCases, act })
})

describe('getChildrenOfEach - a record given is used as given', () => {
	type TestCase = BaseXmlTestCase & { expected: { given: string[]; ref: string[] } }

	const testCases: TestCases<TestCase> = {
		'a record read before a staged child is created → the record as given has no new child, the ref has':
			{
				sourceXml: xml,
				expected: { given: ['aa1', 'aa2'], ref: ['aa1', 'aa2', '0-0-0-0-5'] },
			},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const answer = await source.transaction(async (tx) => {
			const before = await tx.getRecord(a1)
			if (!before) throw new Error('a1 is in the document')
			await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-5', attributes: { aAA_2: 'v' } })
			const lists = await tx.getChildrenOfEach([before, a1], { tagName: 'AA_2' })
			return {
				given: lists[0]?.map((record) => record.id),
				ref: lists[1]?.map((record) => record.id),
			}
		})

		expect(answer).toEqual(testCase.expected)
	}

	transparentRunner.withoutExport({ testCases, act })
})

describe('getChildren - one parent through getChildrenOfEach, a record given read again', () => {
	type TestCase = BaseXmlTestCase & { expected: string[] }

	const testCases: TestCases<TestCase> = {
		'a record read before a staged child is created → getChildren of that record answers the new child':
			{
				sourceXml: xml,
				expected: ['aa1', 'aa2', '0-0-0-0-6'],
			},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const ids = await source.transaction(async (tx) => {
			const before = await tx.getRecord(a1)
			await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-6', attributes: { aAA_2: 'v' } })
			const children = await tx.getChildren(before, 'AA_2')
			return children.map((record) => record.id)
		})

		expect(ids).toEqual(testCase.expected)
	}

	transparentRunner.withoutExport({ testCases, act })
})
