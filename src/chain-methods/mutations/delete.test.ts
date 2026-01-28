import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { FromElementParams } from '@/dialecte/types'
import type { ElementsOf } from '@/types'

describe('CRUD Operations - deleteElement', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		deleteElement: FromElementParams<TestConfig, TestElement>
		expected: {
			focusAfterDelete: FromElementParams<TestConfig, TestElement>
			elementShouldNotExist: FromElementParams<TestConfig, TestElement>
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'delete leaf element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			deleteElement: { tagName: 'A', id: '2' },
			expected: {
				focusAfterDelete: { tagName: 'Root', id: '1' },
				elementShouldNotExist: { tagName: 'A', id: '2' },
			},
		},
		{
			description: 'delete element with single child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="val"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			deleteElement: { tagName: 'A', id: '2' },
			expected: {
				focusAfterDelete: { tagName: 'Root', id: '1' },
				elementShouldNotExist: { tagName: 'A', id: '2' },
			},
		},
		{
			description: 'delete element with multiple children',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="val"><AA_1 ${DEV_ID}="3" aAA_1="child1" /><AA_2 ${DEV_ID}="4" aAA_2="child2" /></A></Root>`,
			deleteElement: { tagName: 'A', id: '2' },
			expected: {
				focusAfterDelete: { tagName: 'Root', id: '1' },
				elementShouldNotExist: { tagName: 'A', id: '2' },
			},
		},
		{
			description: 'delete nested child element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="val"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			deleteElement: { tagName: 'AA_1', id: '3' },
			expected: {
				focusAfterDelete: { tagName: 'A', id: '2' },
				elementShouldNotExist: { tagName: 'AA_1', id: '3' },
			},
		},
	]

	testCases.forEach(({ description, xml, deleteElement, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				let chain = dialecte.fromElement(deleteElement).delete()
				const context = await chain.getContext()
				await chain.commit()

				// Verify focus moved to parent
				expect(context.currentFocus.tagName).toBe(expected.focusAfterDelete.tagName)
				expect(context.currentFocus.id).toBe(expected.focusAfterDelete.id)

				// Verify element no longer exists (should throw)
				await expect(
					dialecte.fromElement(expected.elementShouldNotExist).getContext(),
				).rejects.toThrow()
			} finally {
				await cleanup()
			}
		})
	})

	describe('cascading delete', () => {
		it('deletes all descendants recursively', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="val"><AA_1 ${DEV_ID}="3" aAA_1="nested"><AAA_1 ${DEV_ID}="4" aAAA_1="deeply" /></AA_1></A></Root>`,
			})

			try {
				await dialecte.fromElement({ tagName: 'A', id: '2' }).delete().commit()

				// Verify all descendants are deleted
				await expect(dialecte.fromElement({ tagName: 'A', id: '2' }).getContext()).rejects.toThrow()
				await expect(
					dialecte.fromElement({ tagName: 'AA_1', id: '3' }).getContext(),
				).rejects.toThrow()
				await expect(
					dialecte.fromElement({ tagName: 'AAA_1', id: '4' }).getContext(),
				).rejects.toThrow()
			} finally {
				await cleanup()
			}
		})
	})

	describe('error handling', () => {
		it('throws error when trying to delete root element', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			})

			try {
				const chain = dialecte.fromRoot().delete()
				await expect(chain.getContext()).rejects.toThrow('Cannot delete root element')
			} finally {
				await cleanup()
			}
		})
	})
})
