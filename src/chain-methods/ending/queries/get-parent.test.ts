import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { FromElementParams } from '@/dialecte'
import type { ElementsOf } from '@/types'

describe('getParent', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		startFrom: FromElementParams<TestConfig, TestElement>
		expected: {
			parentTagName: TestElement
			parentId: string
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'returns parent of immediate child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			expected: {
				parentTagName: 'Root',
				parentId: '1',
			},
		},
		{
			description: 'returns parent of nested child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			startFrom: { tagName: 'AA_1', id: '3' },
			expected: {
				parentTagName: 'A',
				parentId: '2',
			},
		},
		{
			description: 'returns parent of deeply nested element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="l2"><AAA_1 ${DEV_ID}="4" aAAA_1="l3"><AAAA_1 ${DEV_ID}="5" aAAAA_1="l4" /></AAA_1></AA_1></A></Root>`,
			startFrom: { tagName: 'AAAA_1', id: '5' },
			expected: {
				parentTagName: 'AAA_1',
				parentId: '4',
			},
		},
		{
			description: 'returns parent of second child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="first" /><A ${DEV_ID}="3" aA="second" /></Root>`,
			startFrom: { tagName: 'A', id: '3' },
			expected: {
				parentTagName: 'Root',
				parentId: '1',
			},
		},
	]

	testCases.forEach(({ description, xml, startFrom, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				const parent = await dialecte.fromElement(startFrom).getParent()

				expect(parent).toBeDefined()
				expect(parent?.tagName).toBe(expected.parentTagName)
				expect(parent?.id).toBe(expected.parentId)
			} finally {
				await cleanup()
			}
		})
	})

	describe('error handling', () => {
		it('throws error when getting parent of root element', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			})

			try {
				await expect(dialecte.fromRoot().getParent()).rejects.toThrow(
					'Current element has no parent',
				)
			} finally {
				await cleanup()
			}
		})
	})
})
