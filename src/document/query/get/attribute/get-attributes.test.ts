import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'

import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const nsExt = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`
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
		'fills required attribute with empty default when none provided': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: { aA: '' },
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
		const result = await source.query.getAttributes(testCase.ref)
		expect(result).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getAttributes (namespace scoping)', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		namespace?: string
		expected: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'no namespace option → returns only default-namespace attributes (local keys)': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" ext:cA="qualified" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: { aA: 'hi' },
		},
		'scoped by namespace key → returns only that namespace, keyed by local name': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" ext:cA="qualified" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			namespace: 'ext',
			expected: { cA: 'qualified' },
		},
		'scoped by namespace with no matching attribute → empty object': {
			sourceXml: /* xml */ `
				<Root ${nsExt}>
					<A ${customId}="a1" aA="hi" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			namespace: 'ext',
			expected: {},
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttributes(
			testCase.ref,
			(testCase.namespace ? { namespace: testCase.namespace } : undefined) as never,
		)
		expect(result).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act })
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
		'fills required attribute with empty default when none provided': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [{ name: 'aA', value: '' }],
		},
		'returns empty array when ref does not exist': {
			sourceXml: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			expected: [],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const result = await source.query.getAttributes(testCase.ref, { fullObject: true })
		expect(result).toEqual(
			expect.arrayContaining(testCase.expected.map((e) => expect.objectContaining(e))),
		)
		expect(result).toHaveLength(testCase.expected.length)
	}

	runTestCases.withoutExport({ testCases, act })
})
