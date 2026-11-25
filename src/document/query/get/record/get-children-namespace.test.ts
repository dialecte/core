import { TRANSPARENT_CONFIG } from '../tree/get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestRunner } from '@/test'

import type { TransparentTestDialecteConfig } from '../tree/get-tree.fixtures.types'
import type { ActParams, BaseXmlTestCase, TestCases } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const runTransparentCases = createTestRunner<TransparentTestDialecteConfig>({
	dialecteConfig: TRANSPARENT_CONFIG,
})

/**
 * AA_1 is transparent: a1 holds the dialecte's AA_1, a2 an AA_1 in another namespace, a3 both (the foreign one first);
 * each AA_1 over one AAA_1.
 */
const sourceXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} xmlns:other="urn:test:other">
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v" />
			</AA_1>
		</A>
		<A ${customId}="a2" aA="v">
			<other:AA_1 ${customId}="aa2">
				<AAA_1 ${customId}="aaa2" aAAA_1="v" />
			</other:AA_1>
		</A>
		<A ${customId}="a3" aA="v">
			<other:AA_1 ${customId}="aa3">
				<AAA_1 ${customId}="aaa3" aAAA_1="v" />
			</other:AA_1>
			<AA_1 ${customId}="aa4" aAA_1="v">
				<AAA_1 ${customId}="aaa4" aAAA_1="v" />
			</AA_1>
		</A>
	</Root>
`

type TestCase = BaseXmlTestCase & { id: string; expectedIds: string[] }

const testCases: TestCases<TestCase> = {
	'own AA_1 → looked into': { sourceXml, id: 'a1', expectedIds: ['aaa1'] },
	'foreign AA_1 → not looked into': { sourceXml, id: 'a2', expectedIds: [] },
	'foreign and own AA_1 → only the own one looked into': {
		sourceXml,
		id: 'a3',
		expectedIds: ['aaa4'],
	},
}

/** Contract: getChild looks through a transparent element only in its own namespace. */
describe('getChild - transparent only in its own namespace', () => {
	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, TestCase>): Promise<void> {
		const child = await source.query.any.getChild({ tagName: 'A', id: testCase.id }, 'AAA_1')
		expect(child ? [child.id] : []).toEqual(testCase.expectedIds)
	}

	runTransparentCases.withoutExport({ testCases, act })
})

/** Contract: getChildren looks through a transparent element only in its own namespace. */
describe('getChildren - transparent only in its own namespace', () => {
	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, TestCase>): Promise<void> {
		const children = await source.query.any.getChildren({ tagName: 'A', id: testCase.id }, 'AAA_1')
		expect(children.map((child) => child.id)).toEqual(testCase.expectedIds)
	}

	runTransparentCases.withoutExport({ testCases, act })
})

/** Contract: getChildrenOfEach applies the same rule to each position. */
describe('getChildrenOfEach - transparent only in its own namespace', () => {
	type EachCase = BaseXmlTestCase & { expectedIds: string[][] }

	const eachCases: TestCases<EachCase> = {
		'own, foreign, both → each position by its own wrappers': {
			sourceXml,
			expectedIds: [['aaa1'], [], ['aaa4']],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TransparentTestDialecteConfig, EachCase>): Promise<void> {
		const lists = await source.query.any.getChildrenOfEach(
			[
				{ tagName: 'A', id: 'a1' },
				{ tagName: 'A', id: 'a2' },
				{ tagName: 'A', id: 'a3' },
			],
			{ tagName: 'AAA_1' },
		)
		expect(lists.map((list) => list.map((child) => child.id))).toEqual(testCase.expectedIds)
	}

	runTransparentCases.withoutExport({ testCases: eachCases, act })
})
