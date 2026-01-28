import { describe, it, expect } from 'vitest'

import { CoreChain } from '@/chain-methods'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	ChainTestOperation,
	executeChainOperations,
} from '.'

import type { ElementsOf, ChildrenOf } from '@/types'

describe('executeChainOperations', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>
	type TestChild = ChildrenOf<TestConfig, TestElement>

	type TestCase = {
		description: string
		xml: string
		operations: ChainTestOperation<TestConfig, TestElement, TestChild>[]
		expected: {
			focusTagName: TestElement
			stagedOperationsCount: number
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'handles empty operations',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [],
			expected: {
				focusTagName: 'Root',
				stagedOperationsCount: 0,
			},
		},
		{
			description: 'executes single addChild operation',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [
				{
					type: 'addChild',
					tagName: 'A',
					attributes: { aA: 'value' },
					setFocus: false,
				},
			],
			expected: {
				focusTagName: 'Root',
				stagedOperationsCount: 2, // create + parent update
			},
		},
		{
			description: 'executes operations in sequence',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [
				{
					type: 'addChild',
					tagName: 'A',
					attributes: { aA: 'val1' },
					setFocus: true,
				},
				{
					type: 'addChild',
					tagName: 'AA_1',
					attributes: { aAA_1: 'val2' },
					setFocus: false,
				},
			],
			expected: {
				focusTagName: 'A',
				stagedOperationsCount: 4, // 2 creates + 2 parent updates
			},
		},
		{
			description: 'executes mixed operations (create, update, delete)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="old" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'new' },
				},
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					goTo: { tagName: 'A', id: '2' },
					tagName: 'AA_1',
					attributes: { aAA_1: 'child' },
					setFocus: false,
				},
				{
					type: 'delete',
					goTo: { tagName: 'AA_1', id: '0-0-0-0-1' },
				},
			],
			expected: {
				focusTagName: 'A',
				stagedOperationsCount: 5, // update + create + parent update + delete + parent update
			},
		},
	]

	testCases.forEach(({ description, xml, operations, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const context = await executeChainOperations({
					chain: dialecte.fromRoot() as CoreChain<TestConfig, TestElement>,
					operations,
				})

				expect(context.currentFocus.tagName).toBe(expected.focusTagName)
				expect(context.stagedOperations.length).toBe(expected.stagedOperationsCount)
			} finally {
				await cleanup()
			}
		})
	})

	describe('commit behavior', () => {
		it('commits operations to database', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			})

			try {
				await executeChainOperations({
					chain: dialecte.fromRoot(),
					operations: [
						{
							type: 'addChild',
							tagName: 'A',
							attributes: { aA: 'value' },
							setFocus: false,
						},
					],
				})

				// Verify element persisted to database
				const refetchedContext = await dialecte.fromElement({ tagName: 'A' }).getContext()
				expect(refetchedContext.currentFocus.tagName).toBe('A')
			} finally {
				await cleanup()
			}
		})
	})
})
