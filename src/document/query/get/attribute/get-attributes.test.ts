import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test'

import type { TestDialecteConfig } from '@/test'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttributes', () => {
	type TestCase = {
		description: string
		xmlString: string
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: Record<string, string>
	}

	const testCases: TestCase[] = [
		{
			description: 'returns value object for all present attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: { aA: 'hello' },
		},
		{
			description: 'returns empty object when record has no attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: {},
		},
		{
			description: 'returns empty object when ref does not exist',
			xmlString: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			expected: {},
		},
		{
			description: 'returns multiple attributes when record has several',
			xmlString: /* xml */ `
				<Root ${ns}>
					<AA_1 ${customId}="aa1" aAA_1="v1" />
				</Root>
			`,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expected: { aAA_1: 'v1' },
		},
	]

	it.each(testCases)('$description', async ({ xmlString, ref, expected }) => {
		const { document, cleanup } = await createTestDialecte({ xmlString })

		try {
			const result = await document.query.getAttributes(ref)
			expect(result).toEqual(expected)
		} finally {
			await cleanup()
		}
	})
})

describe('getAttributesFullObject', () => {
	type TestCase = {
		description: string
		xmlString: string
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: { name: string; value: string }[]
	}

	const testCases: TestCase[] = [
		{
			description: 'returns full attribute objects for all present attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [{ name: 'aA', value: 'world' }],
		},
		{
			description: 'returns empty array when record has no attributes',
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			expected: [],
		},
		{
			description: 'returns empty array when ref does not exist',
			xmlString: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			expected: [],
		},
	]

	it.each(testCases)('$description', async ({ xmlString, ref, expected }) => {
		const { document, cleanup } = await createTestDialecte({ xmlString })

		try {
			const result = await document.query.getAttributes(ref, { fullObject: true })
			expect(result).toEqual(
				expect.arrayContaining(expected.map((e) => expect.objectContaining(e))),
			)
			expect(result).toHaveLength(expected.length)
		} finally {
			await cleanup()
		}
	})
})
