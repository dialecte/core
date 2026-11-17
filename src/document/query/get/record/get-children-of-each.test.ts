import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	createTestRunner,
	runTestCases,
} from '@/test'

import type { AnyRefOrRecord, Document } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** AA_1 is transparent: its children are looked up from its parent when the parent has none of the tag. */
const TRANSPARENT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	transparentElements: ['AA_1'] as const,
} as unknown as TestDialecteConfig

const transparentRunner = createTestRunner({ dialecteConfig: TRANSPARENT_CONFIG })

type TestCase = BaseXmlTestCase & {
	inputs: AnyRefOrRecord[]
	tagName: string
	expected: string[][]
}

/** The ids of each list, and, for every ref input, a check that `getChildren` answers the same children. */
async function answerOf(params: {
	document: Document<TestDialecteConfig>
	testCase: TestCase
}): Promise<string[][]> {
	const { document, testCase } = params
	const lists = await document.query.any.getChildrenOfEach(testCase.inputs, {
		tagName: testCase.tagName,
	})

	for (const [position, input] of testCase.inputs.entries()) {
		if ('parent' in input) continue
		const one = await document.query.any.getChildren(input, testCase.tagName)
		expect(lists[position]?.map((record) => record.id)).toEqual(one.map((record) => record.id))
	}
	for (const record of lists.flat()) {
		expect([record.tagName, record.status]).toEqual([testCase.tagName, 'unchanged'])
	}
	return lists.map((list) => list.map((record) => record.id))
}

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="first" />
			<AA_2 ${customId}="aa3" aAA_2="v" />
			<AA_1 ${customId}="aa2" aAA_1="second" />
		</A>
		<A ${customId}="a2" aA="v">
			<AA_1 ${customId}="aa4" aAA_1="v" />
		</A>
		<A ${customId}="a3" aA="v" />
	</Root>
`

const a1 = { tagName: 'A', id: 'a1' } as const
const a2 = { tagName: 'A', id: 'a2' } as const
const a3 = { tagName: 'A', id: 'a3' } as const

/** An A the store does not hold, naming the stored aa4 as its child: answered from its own `children`, never read. */
const givenWithAa4 = createTestRecord({
	type: 'tracked',
	record: { tagName: 'A', id: 'given', children: [{ tagName: 'AA_1', id: 'aa4' }] },
})

describe('getChildrenOfEach', () => {
	describe('the children of a tag of each parent, as getChildren answers them', () => {
		const testCases: TestCases<TestCase> = {
			'three parents → each its children of the tag, in document order': {
				sourceXml: xml,
				inputs: [a1, a2, a3],
				tagName: 'AA_1',
				expected: [['aa1', 'aa2'], ['aa4'], []],
			},
			'another tag → only the children of that tag': {
				sourceXml: xml,
				inputs: [a1, a2],
				tagName: 'AA_2',
				expected: [['aa3'], []],
			},
			'a parent that does not exist → [] at its position': {
				sourceXml: xml,
				inputs: [a1, { tagName: 'A', id: 'missing' }, a2],
				tagName: 'AA_1',
				expected: [['aa1', 'aa2'], [], ['aa4']],
			},
			'the same parent twice → the same children at each of its positions': {
				sourceXml: xml,
				inputs: [a2, a1, a2],
				tagName: 'AA_1',
				expected: [['aa4'], ['aa1', 'aa2'], ['aa4']],
			},
			'a record given and a ref → the record answered from its own children': {
				sourceXml: xml,
				inputs: [givenWithAa4, a1],
				tagName: 'AA_1',
				expected: [['aa4'], ['aa1', 'aa2']],
			},
			'no parent → no list': {
				sourceXml: xml,
				inputs: [],
				tagName: 'AA_1',
				expected: [],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const answer = await answerOf({ document: source, testCase })
			expect(answer).toEqual(testCase.expected)
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('through transparent elements', () => {
		const wrappedXml = /* xml */ `
			<Root ${ns}>
				<A ${customId}="a1" aA="v">
					<AA_1 ${customId}="w1" aAA_1="wrapper">
						<AAA_1 ${customId}="x1" aAAA_1="v" />
						<AAA_1 ${customId}="x2" aAAA_1="v" />
					</AA_1>
				</A>
				<A ${customId}="a2" aA="v">
					<AA_1 ${customId}="w2" aAA_1="wrapper">
						<AAA_1 ${customId}="x3" aAAA_1="v" />
					</AA_1>
					<AA_2 ${customId}="other" aAA_2="v" />
					<AA_1 ${customId}="w3" aAA_1="wrapper">
						<AAA_1 ${customId}="x4" aAAA_1="v" />
					</AA_1>
				</A>
				<A ${customId}="a3" aA="v">
					<AA_1 ${customId}="w4" aAA_1="empty-wrapper" />
				</A>
			</Root>
		`

		const testCases: TestCases<TestCase> = {
			'parents with wrappers → the children of the tag inside the wrappers of each parent': {
				sourceXml: wrappedXml,
				inputs: [a1, a2, a3],
				tagName: 'AAA_1',
				expected: [['x1', 'x2'], ['x3', 'x4'], []],
			},
			'a wrapper given as a parent and its own parent → its direct children, then the same through it':
				{
					sourceXml: wrappedXml,
					inputs: [{ tagName: 'AA_1', id: 'w1' }, a1],
					tagName: 'AAA_1',
					expected: [
						['x1', 'x2'],
						['x1', 'x2'],
					],
				},
			'the transparent tag itself asked → the direct wrappers, not looked through': {
				sourceXml: wrappedXml,
				inputs: [a2, a3],
				tagName: 'AA_1',
				expected: [['w2', 'w3'], ['w4']],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const answer = await answerOf({ document: source, testCase })
			expect(answer).toEqual(testCase.expected)
		}

		transparentRunner.withoutExport({ testCases, act })

		const opaqueCases: TestCases<TestCase> = {
			'a config without transparent elements → nothing found inside wrappers': {
				sourceXml: wrappedXml,
				inputs: [a1, a2],
				tagName: 'AAA_1',
				expected: [[], []],
			},
		}

		runTestCases.withoutExport({ testCases: opaqueCases, act })
	})
})
