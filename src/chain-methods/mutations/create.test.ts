import { AddChildParams } from './create.types'

import { describe, it, expect } from 'vitest'

import { FromElementParams } from '@/dialecte'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test-fixtures'

import type { ElementsOf, ChildrenOf, RawRecord, AnyDialecteConfig, Context } from '@/types'

describe('CRUD Operations - addChild', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>
	type ChildElement = ChildrenOf<TestConfig, TestElement>

	type testCase = {
		description: string
		xml: string
		operations: AddChildParams<TestConfig, TestElement, ChildElement>[]
		expected: {
			focus: TestElement
			children: FromElementParams<TestConfig, TestElement>[]
		}
	}

	const testCases: testCase[] = [
		{
			description: 'create child without changing focus (setFocus: false)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
			operations: [
				{
					tagName: 'A',
					attributes: { aA: 'value' },
					setFocus: false,
				},
			],
			expected: {
				focus: 'Root',
				children: [
					{
						tagName: 'A',
					},
				],
			},
		},
		{
			description: 'create child and change focus (setFocus: true)',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
			operations: [
				{
					tagName: 'A',
					attributes: { aA: 'value' },
					setFocus: true,
				},
			],
			expected: {
				focus: 'A',
				children: [
					{
						tagName: 'A',
					},
				],
			},
		},
		{
			description: 'create nested elements with setFocus: true',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
			operations: [
				{
					tagName: 'A',
					attributes: { aA: 'value' },
					setFocus: true,
				},
				{
					id: '0-0-0-0-1',
					tagName: 'AA_1',
					attributes: { aAA_1: 'nested' },
					setFocus: true,
				},
			],
			expected: {
				focus: 'AA_1',
				children: [
					{
						tagName: 'A',
					},
					{
						tagName: 'AA_1',
						id: '0-0-0-0-1',
					},
				],
			},
		},
		{
			description: 'create multiple children without changing focus',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
			operations: [
				{
					tagName: 'A',
					attributes: { aA: 'a1' },
					setFocus: false,
				},
				{
					tagName: 'B',
					attributes: { aB: 'b1' },
					setFocus: false,
				},
			],
			expected: {
				focus: 'Root',
				children: [{ tagName: 'A' }, { tagName: 'B' }],
			},
		},
	]

	testCases.forEach(({ description, xml, operations, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: xml,
			})

			try {
				let chain: any = dialecte.fromRoot()
				for (const operation of operations) {
					chain = chain.addChild(operation)
				}

				const context = await chain.getContext()
				expect(context.currentFocus.tagName).toBe(expected.focus)

				await chain.commit()

				// Verify all expected children exist
				for (const child of expected.children) {
					const childContext = await dialecte.fromElement(child).getContext()
					expect(childContext.currentFocus.tagName).toBe(child.tagName)
				}
			} finally {
				await cleanup()
			}
		})
	})

	describe('hook integration', () => {
		it('calls afterCreated hook when creating children', async () => {
			let hookCalled = false
			let hookChildRecord: unknown
			let hookParentRecord: unknown

			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
				dialecteConfig: {
					...TEST_DIALECTE_CONFIG,
					hooks: {
						afterCreated: <
							GenericConfig extends AnyDialecteConfig,
							GenericElement extends ElementsOf<GenericConfig>,
							GenericParentElement extends ElementsOf<GenericConfig>,
						>(params: {
							childRecord: RawRecord<GenericConfig, GenericElement>
							parentRecord: RawRecord<GenericConfig, GenericParentElement>
							context: Context<GenericConfig, GenericParentElement>
						}) => {
							const { childRecord, parentRecord } = params
							hookCalled = true
							hookChildRecord = childRecord
							hookParentRecord = parentRecord
							return []
						},
					},
				},
			})

			try {
				await dialecte
					.fromRoot()
					.addChild({ tagName: 'A', attributes: { aA: 'value' } })
					.getContext()

				expect(hookCalled).toBe(true)
				expect(hookChildRecord).toBeDefined()
				expect(hookParentRecord).toBeDefined()
			} finally {
				await cleanup()
			}
		})

		it('reflects hook parent updates in subsequent addChild operations', async () => {
			const { dialecte, cleanup } = await createTestDialecte({
				xmlString: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1" />`,
				dialecteConfig: {
					...TEST_DIALECTE_CONFIG,
					hooks: {
						afterCreated: <
							GenericConfig extends AnyDialecteConfig,
							GenericElement extends ElementsOf<GenericConfig>,
							GenericParentElement extends ElementsOf<GenericConfig>,
						>(params: {
							childRecord: RawRecord<GenericConfig, GenericElement>
							parentRecord: RawRecord<GenericConfig, GenericParentElement>
							context: Context<GenericConfig, GenericParentElement>
						}) => {
							const { childRecord, parentRecord } = params

							// Simulate hook removing child from parent
							const updatedParent: RawRecord<GenericConfig, GenericParentElement> = {
								...parentRecord,
								children: parentRecord.children.filter((c) => c.id !== childRecord.id),
							}

							return [
								{
									status: 'updated' as const,
									oldRecord: parentRecord,
									newRecord: updatedParent,
								},
							]
						},
					},
				},
			})

			try {
				const chain = dialecte
					.fromRoot()
					.addChild({ tagName: 'A', id: '0-0-0-0-1', attributes: { aA: 'val1' }, setFocus: false })
					.addChild({ tagName: 'A', id: '0-0-0-0-2', attributes: { aA: 'val2' }, setFocus: false })

				const context = await chain.getContext()

				// Verify: Root's children should be empty (both removed by hook)
				expect(context.currentFocus.children.length).toBe(0)

				// Verify: Staged operations show both children were removed
				const updateOps = context.stagedOperations.filter((op) => op.status === 'updated')
				const finalRootUpdate = updateOps[updateOps.length - 1]
				expect(finalRootUpdate.newRecord?.children.length).toBe(0)
			} finally {
				await cleanup()
			}
		})
	})
})
