import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import { GoToElementParams } from '../navigation'

import type { ElementsOf } from '@/types'

describe('CRUD Operations - updateElement', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		goTo: GoToElementParams<TestConfig, TestElement>
		update: {
			attributes?: Record<string, string>
			value?: string
		}
		expected: {
			attributes?: Record<string, string>
			value?: string
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'update multiple attributes',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><AA_1 ${DEV_ID}="2" aAA_1="val1" bAA_1="val2" /></Root>`,
			goTo: { tagName: 'AA_1', id: '2' },
			update: { attributes: { aAA_1: 'new1', bAA_1: 'new2' } },
			expected: { attributes: { aAA_1: 'new1', bAA_1: 'new2' } },
		},
		{
			description: 'update both attributes and value',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="original">old</A></Root>`,
			goTo: { tagName: 'A', id: '2' },
			update: { attributes: { aA: 'new' }, value: 'new value' },
			expected: { attributes: { aA: 'new' }, value: 'new value' },
		},
		{
			description: 'update one attribute preserves others',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><AA_1 ${DEV_ID}="2" aAA_1="val1" bAA_1="val2" cAA_1="val3" /></Root>`,
			goTo: { tagName: 'AA_1', id: '2' },
			update: { attributes: { bAA_1: 'updated' } },
			expected: { attributes: { aAA_1: 'val1', bAA_1: 'updated', cAA_1: 'val3' } },
		},
	]

	testCases.forEach(({ description, xml, goTo, update, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				const context = await dialecte.fromRoot().goToElement(goTo).update(update).getContext()

				// Check attributes
				if (expected.attributes) {
					for (const [attrName, attrValue] of Object.entries(expected.attributes)) {
						const attribute = context.currentFocus.attributes.find((a) => a.name === attrName)
						expect(attribute?.value).toBe(attrValue)
					}
				}

				// Check value
				if (expected.value !== undefined) {
					expect(context.currentFocus.value).toBe(expected.value)
				}
			} finally {
				await cleanup()
			}
		})
	})
})
