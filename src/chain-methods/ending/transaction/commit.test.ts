import { describe, it, expect } from 'vitest'

import { FromElementParams } from '@/dialecte'
import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	executeChainOperations,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { CoreChain } from '@/chain-methods'
import type { ChainTestOperation } from '@/helpers'
import type { ElementsOf, ChildrenOf } from '@/types'

describe('commit', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>
	type ChildElement = ChildrenOf<TestConfig, TestElement>

	type TestCase = {
		description: string
		xml: string
		operations: ChainTestOperation<TestConfig, TestElement, ChildElement>[]
		expected: {
			elementExists?: FromElementParams<TestConfig, TestElement>
			elementNotExists?: FromElementParams<TestConfig, TestElement>
			attributeValue?: {
				element: FromElementParams<TestConfig, TestElement>
				attribute: string
				value: string
			}
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'commits single create operation',
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
				elementExists: { tagName: 'A' },
			},
		},
		{
			description: 'commits single update operation',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="old" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'new' },
				},
			],
			expected: {
				attributeValue: {
					element: { tagName: 'A', id: '2' },
					attribute: 'aA',
					value: 'new',
				},
			},
		},
		{
			description: 'commits single delete operation',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			operations: [
				{
					type: 'delete',
					goTo: { tagName: 'A', id: '2' },
				},
			],
			expected: {
				elementNotExists: { tagName: 'A', id: '2' },
			},
		},
		{
			description: 'commits multiple create operations',
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
				elementExists: { tagName: 'A' },
			},
		},
		{
			description: 'commits mixed operations (create, update, delete)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="old" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'updated' },
				},
				{
					type: 'addChild',
					id: '0-0-0-0-1',
					goTo: { tagName: 'A', id: '2' },
					tagName: 'AA_1',
					attributes: { aAA_1: 'new' },
					setFocus: false,
				},
				{
					type: 'delete',
					goTo: { tagName: 'AA_1', id: '0-0-0-0-1' },
				},
			],
			expected: {
				attributeValue: {
					element: { tagName: 'A', id: '2' },
					attribute: 'aA',
					value: 'updated',
				},
				elementNotExists: { tagName: 'AA_1', id: '0-0-0-0-1' },
			},
		},
		{
			description: 'merges multiple operations on same element',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="v1" /></Root>`,
			operations: [
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'v2' },
				},
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'v3' },
				},
				{
					type: 'update',
					goTo: { tagName: 'A', id: '2' },
					attributes: { aA: 'final' },
				},
			],
			expected: {
				attributeValue: {
					element: { tagName: 'A', id: '2' },
					attribute: 'aA',
					value: 'final',
				},
			},
		},
		{
			description: 'handles empty operations (no-op commit)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1" />`,
			operations: [],
			expected: {},
		},
	]

	testCases.forEach(({ description, xml, operations, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				// Execute and commit operations
				await executeChainOperations({
					chain: dialecte.fromRoot() as CoreChain<TestConfig, TestElement>,
					operations,
				})

				// Verify expected results
				if (expected.elementExists) {
					const elementContext = await dialecte.fromElement(expected.elementExists).getContext()
					expect(elementContext.currentFocus.tagName).toBe(expected.elementExists.tagName)
				}

				if (expected.elementNotExists) {
					await expect(
						dialecte.fromElement(expected.elementNotExists).getContext(),
					).rejects.toThrow()
				}

				if (expected.attributeValue) {
					const elementContext = await dialecte
						.fromElement(expected.attributeValue.element)
						.getContext()
					const attribute = elementContext.currentFocus.attributes.find(
						(a: any) => a.name === expected.attributeValue!.attribute,
					)
					expect(attribute?.value).toBe(expected.attributeValue.value)
				}

				// Verify staged operations are cleared after commit
				const contextAfter = await dialecte.fromRoot().getContext()
				expect(contextAfter.stagedOperations.length).toBe(0)
			} finally {
				await cleanup()
			}
		})
	})
})
