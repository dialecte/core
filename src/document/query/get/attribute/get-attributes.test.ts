import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runXmlTestCases } from '@/test'

import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttributes', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'returns value object for all present attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: { aA: 'hello' },
		},
		'returns empty object when record has no attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: {},
		},
		'returns empty object when ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,

			ref: { tagName: 'A', id: 'missing' },
			expected: {},
		},
		'returns multiple attributes when record has several': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<AA_1 ${customId}="aa1" aAA_1="v1" />
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expected: { aAA_1: 'v1' },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.getAttributes(testCase.ref)
		expect(result).toEqual(testCase.expected)
	}

	runXmlTestCases({ testCases, act })
})

describe('getAttributesFullObject', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: { name: string; value: string }[]
	}

	const testCases: Record<string, TestCase> = {
		'returns full attribute objects for all present attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [{ name: 'aA', value: 'world' }],
		},
		'returns empty array when record has no attributes': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [],
		},
		'returns empty array when ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			expected: [],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.getAttributes(testCase.ref, { fullObject: true })
		expect(result).toEqual(
			expect.arrayContaining(testCase.expected.map((e) => expect.objectContaining(e))),
		)
		expect(result).toHaveLength(testCase.expected.length)
	}

	runXmlTestCases({ testCases, act })
})
