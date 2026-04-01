import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test'

import type { TestDialecteConfig } from '@/test'
import type { AttributesOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getAttribute', () => {
	type TestCase = {
		xmlString: string
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'returns attribute value when it exists': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="hello" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: 'hello',
		},
		"returns '' when attribute does not exist on the record": {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
		"returns '' when the ref does not exist": {
			xmlString: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: '',
		},
		'returns empty string for an empty attribute value': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: '',
		},
	}

	it.each(Object.entries(testCases))('%s', async (_, tc) => {
		const { document, cleanup } = await createTestDialecte({ xmlString: tc.xmlString })

		try {
			const result = await document.query.getAttribute(tc.ref, { name: tc.attributeName as 'aA' })
			expect(result).toBe(tc.expected)
		} finally {
			await cleanup()
		}
	})
})

describe('getAttributeFullObject', () => {
	type TestCase = {
		xmlString: string
		ref: Ref<TestDialecteConfig, 'A'>
		attributeName: AttributesOf<TestDialecteConfig, 'A'>
		expected: { name: string; value: string } | undefined
	}

	const testCases: Record<string, TestCase> = {
		'returns the full attribute object when it exists': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="world" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: { name: 'aA', value: 'world' },
		},
		'returns undefined when attribute does not exist on the record': {
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'a1' },
			attributeName: 'aA',
			expected: undefined,
		},
		'returns undefined when the ref does not exist': {
			xmlString: /* xml */ `<Root ${ns} />`,
			ref: { tagName: 'A', id: 'missing' },
			attributeName: 'aA',
			expected: undefined,
		},
	}

	it.each(Object.entries(testCases))('%s', async (_, tc) => {
		const { document, cleanup } = await createTestDialecte({ xmlString: tc.xmlString })

		try {
			const result = await document.query.getAttribute(tc.ref, {
				name: tc.attributeName as 'aA',
				fullObject: true,
			})
			if (tc.expected === undefined) {
				expect(result).toBeUndefined()
			} else {
				expect(result).toMatchObject(tc.expected)
			}
		} finally {
			await cleanup()
		}
	})
})
