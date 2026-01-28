import { GoToElementParams } from './types'

import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { ElementsOf } from '@/types'

describe('Navigation - goToElement', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	const testCases: Array<{
		description: string
		xml: string
		goTo: GoToElementParams<TestConfig, TestElement>
		expected: {
			tagName: TestElement
			id: string
		}
	}> = [
		{
			description: 'navigate to element by id',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /><AA_1 ${DEV_ID}="3" /></Root>`,
			goTo: { tagName: 'AA_1', id: '3' },
			expected: { tagName: 'AA_1', id: '3' },
		},
		{
			description: 'navigate to singleton without id',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			goTo: { tagName: 'A' },
			expected: { tagName: 'A', id: '2' },
		},
	]

	testCases.forEach(({ description, xml, goTo, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				const chain = dialecte.fromRoot().goToElement(goTo)
				const context = await chain.getContext()

				expect(context.currentFocus.tagName).toBe(expected.tagName)
				expect(context.currentFocus.id).toBe(expected.id)
			} finally {
				await cleanup()
			}
		})
	})

	it('navigate from staged element', async () => {
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
				})
				.commit()

			const chain = dialecte.fromRoot().goToElement({ tagName: 'A', id: '0-0-0-0-1' })
			const context = await chain.getContext()

			expect(context.currentFocus.tagName).toBe('A')
			expect(context.currentFocus.id).toBe('0-0-0-0-1')
		} finally {
			await cleanup()
		}
	})

	it('throw error for non-existent element', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
		})

		try {
			const chain = dialecte.fromRoot().goToElement({ tagName: 'A', id: 'non-existent' })
			await expect(chain.getContext()).rejects.toThrow(
				'Element "A" with id "non-existent" not found',
			)
		} finally {
			await cleanup()
		}
	})

	it('throw error for non-singleton element without id', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><E ${DEV_ID}="2" aE="value" /></Root>`,
		})

		try {
			// @ts-expect-error - Testing runtime error for non-singleton without id
			const chain = dialecte.fromRoot().goToElement({ tagName: 'E' })
			await expect(chain.getContext()).rejects.toThrow('Element E requires an id parameter')
		} finally {
			await cleanup()
		}
	})
})
