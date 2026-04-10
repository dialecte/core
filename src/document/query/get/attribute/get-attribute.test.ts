import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runXmlTestCases } from '@/test'

import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AttributesOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttribute', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'returns attribute value when it exists': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: 'hello',
		},
		"returns '' when attribute does not exist on the record": {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
		"returns '' when the ref does not exist": {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: '',
		},
		'returns empty string for an empty attribute value': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.getAttribute(testCase.ref, {
			name: testCase.attributeName as 'aA',
		})
		expect(result).toBe(testCase.expected)
	}

	runXmlTestCases({ testCases, act })
})

describe('getAttributeFullObject', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: { name: string; value: string } | undefined
	}

	const testCases: Record<string, TestCase> = {
		'returns the full attribute object when it exists': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: { name: 'aA', value: 'world' },
		},
		'returns undefined when attribute does not exist on the record': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: undefined,
		},
		'returns undefined when the ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: undefined,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.document.query.getAttribute(testCase.ref, {
			name: testCase.attributeName as 'aA',
			fullObject: true,
		})
		if (testCase.expected === undefined) {
			expect(result).toBeUndefined()
		} else {
			expect(result).toMatchObject(testCase.expected)
		}
	}

	runXmlTestCases({ testCases, act })
})
