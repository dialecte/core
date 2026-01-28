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

describe('getContext', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		startFrom: FromElementParams<TestConfig, TestElement>
		expected: {
			focusTagName: TestElement
			focusId: string
			hasStagedOperations?: boolean
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'returns context for root element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			startFrom: { tagName: 'Root' },
			expected: {
				focusTagName: 'Root',
				focusId: '1',
			},
		},
		{
			description: 'returns context for specific element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			expected: {
				focusTagName: 'A',
				focusId: '2',
			},
		},
		{
			description: 'returns context for nested element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="nested" /></A></Root>`,
			startFrom: { tagName: 'AA_1', id: '3' },
			expected: {
				focusTagName: 'AA_1',
				focusId: '3',
			},
		},
	]

	testCases.forEach(({ description, xml, startFrom, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				const chain = dialecte.fromElement(startFrom)
				const context = await chain.getContext()

				expect(context.currentFocus.tagName).toBe(expected.focusTagName)
				expect(context.currentFocus.id).toBe(expected.focusId)
			} finally {
				await cleanup()
			}
		})
	})

	it('returns deep cloned snapshot - mutations do not affect returned context', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
		})

		try {
			const chain = dialecte.fromRoot().addChild({ tagName: 'A', attributes: { aA: 'value' } })

			// Get context before commit
			const contextBeforeCommit = await chain.getContext()
			const stagedCountBefore = contextBeforeCommit.stagedOperations.length

			expect(stagedCountBefore).toBeGreaterThan(0)

			// Commit clears staged operations
			await chain.commit()

			// Context snapshot should still have original staged operations
			expect(contextBeforeCommit.stagedOperations.length).toBe(stagedCountBefore)
		} finally {
			await cleanup()
		}
	})

	it('multiple getContext calls return independent snapshots', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
		})

		try {
			const chain = dialecte.fromRoot().addChild({ tagName: 'A', attributes: { aA: 'value' } })

			const context1 = await chain.getContext()
			const context2 = await chain.getContext()

			// Both should have the same data
			expect(context1.currentFocus.tagName).toBe(context2.currentFocus.tagName)
			expect(context1.stagedOperations.length).toBe(context2.stagedOperations.length)

			// But be different objects
			expect(context1).not.toBe(context2)
			expect(context1.stagedOperations).not.toBe(context2.stagedOperations)
		} finally {
			await cleanup()
		}
	})

	it('includes staged operations in context', async () => {
		const { dialecte, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
		})

		try {
			const chain = dialecte
				.fromRoot()
				.addChild({ tagName: 'A', attributes: { aA: 'val1' }, setFocus: true })
				.addChild({ tagName: 'AA_1', attributes: { aAA_1: 'val2' } })

			const context = await chain.getContext()

			expect(context.stagedOperations.length).toBeGreaterThan(0)
			expect(context.stagedOperations.some((op) => op.status === 'created')).toBe(true)
		} finally {
			await cleanup()
		}
	})
})
