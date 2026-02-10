import { describe, it, expect } from 'vitest'

import { FromElementParams } from '@/dialecte'
import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { ElementsOf, ParentsOf } from '@/types'

describe('Navigation - goToParent', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	const testCases: Array<{
		description: string
		xml: string
		startElement: FromElementParams<TestConfig, TestElement>
		parentElement: ParentsOf<TestConfig, TestElement>
		expected: {
			tagName: TestElement
			id: string
		}
	}> = [
		{
			description: 'navigate to parent from child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			startElement: { tagName: 'A', id: '2' },
			parentElement: 'Root',
			expected: { tagName: 'Root', id: '1' },
		},
		{
			description: 'navigate to parent from nested child',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			startElement: { tagName: 'AA_1', id: '3' },
			parentElement: 'A',
			expected: { tagName: 'A', id: '2' },
		},
	]

	testCases.forEach(({ description, xml, startElement, parentElement, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				// @ts-ignore: goToParent is not existing on Root and TS can't resolve union of goToParent signatures from heterogeneous test cases
				const chain = dialecte.fromElement(startElement).goToParent(parentElement)
				const context = await chain.getContext()

				expect(context.currentFocus.tagName).toBe(expected.tagName)
				expect(context.currentFocus.id).toBe(expected.id)
			} finally {
				await cleanup()
			}
		})
	})

	it('navigate to parent from staged element', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
		})

		try {
			await dialecte
				.fromRoot()
				.addChild({
					id: '0-0-0-0-1',
					tagName: 'A',
					attributes: { aA: 'test' },
					setFocus: true,
				})
				.commit()

			const chain = dialecte.fromElement({ tagName: 'A', id: '0-0-0-0-1' })
			const parentChain = chain.goToParent('Root')
			const context = await parentChain.getContext()

			expect(context.currentFocus.tagName).toBe('Root')
			expect(context.currentFocus.id).toBe('1')
		} finally {
			await cleanup()
		}
	})

	describe('multiple levels', () => {
		it('navigates up multiple parent levels', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			})

			try {
				const chain = dialecte
					.fromElement({ tagName: 'AA_1', id: '3' })
					.goToParent('A')
					.goToParent('Root')

				const context = await chain.getContext()

				expect(context.currentFocus.tagName).toBe('Root')
				expect(context.currentFocus.id).toBe('1')
			} finally {
				await cleanup()
			}
		})
	})

	describe('error handling', () => {
		it('goToParent method does not exist on root element', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			})

			try {
				const chain = dialecte.fromRoot()
				expect((chain as any).goToParent).toBeUndefined()
				// resolving promise before cleanup
				await chain.getContext()
			} finally {
				await cleanup()
			}
		})
	})
})
