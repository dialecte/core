import { DeepCloneChildParams } from './clone.types'

import { describe, it, expect } from 'vitest'

import { FromElementParams } from '@/dialecte'
import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	executeChainOperations,
} from '@/helpers'

import type { Chain } from '@/chain-methods'
import type { ChainTestOperation } from '@/helpers'
import type { ElementsOf, TreeRecord, DialecteHooks, ChildrenOf } from '@/types'

const xmlString = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="root">
		<A ${DEV_ID}="a" aA="value1" />
		<B ${DEV_ID}="b">
			<BB_1 ${DEV_ID}="bb1">
				<BBB_1 ${DEV_ID}="bbb1" />
			</BB_1>
			<BB_2 ${DEV_ID}="bb2">
				<BBB_1 ${DEV_ID}="bbb1-2" />
				<BBB_2 ${DEV_ID}="bbb2" />
			</BB_2>
		</B>
		<C ${DEV_ID}="c" />
	</Root>
`

describe('CRUD Operations - deepCloneChild', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>
	type TestChildElement = ChildrenOf<TestConfig, TestElement>

	describe('comprehensive cloning', () => {
		type TestCase = {
			description: string
			operations?: Array<
				ChainTestOperation<TestConfig, TestElement, ChildrenOf<TestConfig, TestElement>>
			>
			sourceSelector: FromElementParams<TestConfig, TestElement>
			targetSelector: FromElementParams<TestConfig, TestElement>
			cloneParams: Omit<DeepCloneChildParams<TestConfig, TestElement>, 'record'>
			expected: {
				focus: string
				clonedElement: {
					tagName: string
					childrenCount: number
				}
				structure?: {
					tagName: TestElement
					children: TestElement[]
				}[]
			}
		}

		const testCases: TestCase[] = [
			{
				description: 'clone simple element without children, setFocus: true',
				sourceSelector: { tagName: 'A' },
				targetSelector: { tagName: 'C' },
				cloneParams: { setFocus: true },
				expected: {
					focus: 'A',
					clonedElement: {
						tagName: 'A',
						childrenCount: 0,
					},
				},
			},
			{
				description: 'clone simple element without children, setFocus: false',
				sourceSelector: { tagName: 'A' },
				targetSelector: { tagName: 'C' },
				cloneParams: { setFocus: false },
				expected: {
					focus: 'C',
					clonedElement: {
						tagName: 'A',
						childrenCount: 0,
					},
				},
			},
			{
				description: 'clone element with nested children, setFocus: true, verify structure',
				sourceSelector: { tagName: 'B' },
				targetSelector: { tagName: 'C' },
				cloneParams: { setFocus: true },
				expected: {
					focus: 'B',
					clonedElement: {
						tagName: 'B',
						childrenCount: 2,
					},
					structure: [
						{
							tagName: 'B',
							children: ['BB_1', 'BB_2'],
						},
						{
							tagName: 'BB_1',
							children: ['BBB_1'],
						},
						{
							tagName: 'BB_2',
							children: ['BBB_1', 'BBB_2'],
						},
					],
				},
			},
			{
				description: 'clone element with nested children, setFocus: false',
				sourceSelector: { tagName: 'B' },
				targetSelector: { tagName: 'C' },
				cloneParams: { setFocus: false },
				expected: {
					focus: 'C',
					clonedElement: {
						tagName: 'B',
						childrenCount: 2,
					},
				},
			},
		]

		testCases.forEach(testCloning)

		function testCloning(testCase: TestCase) {
			it(testCase.description, async () => {
				// Arrange
				const { dialecte, cleanup } = await createTestDialecte({
					xmlString,
				})

				try {
					const sourceChain = dialecte.fromElement(testCase.sourceSelector)
					const sourceRecord = await sourceChain.getTree()

					const targetChain = dialecte.fromElement(testCase.targetSelector)

					// Act
					const resultChain = testCase.cloneParams.setFocus
						? targetChain.deepCloneChild({
								record: sourceRecord as TreeRecord<TestConfig, Exclude<TestElement, 'Root'>>,
								setFocus: true,
							})
						: targetChain.deepCloneChild({
								record: sourceRecord as TreeRecord<TestConfig, Exclude<TestElement, 'Root'>>,
								setFocus: false,
							})

					await resultChain.commit()

					// Assert

					const resultContext = await resultChain.getContext()
					expect(resultContext.currentFocus.tagName).toBe(testCase.expected.focus)

					const targetTree = await dialecte.fromElement(testCase.targetSelector).getTree()
					const clonedChild = targetTree.tree.find(
						(child) => child.tagName === testCase.expected.clonedElement.tagName,
					)
					expect(clonedChild).toBeDefined()
					expect(clonedChild?.tagName).toBe(testCase.expected.clonedElement.tagName)
					expect(clonedChild?.tree.length).toBe(testCase.expected.clonedElement.childrenCount)

					if (testCase.expected.structure) {
						function findElement(
							tree: TreeRecord<TestConfig, TestElement>,
							tagName: TestElement,
						): TreeRecord<TestConfig, TestElement> | null {
							if (tree.tagName === tagName) return tree
							for (const child of tree.tree) {
								const found = findElement(child, tagName)
								if (found) return found
							}
							return null
						}

						for (const expectedNode of testCase.expected.structure) {
							const element = findElement(targetTree, expectedNode.tagName)
							expect(element, `Expected to find ${expectedNode.tagName}`).toBeDefined()

							const childTags = element?.tree.map(
								(child: TreeRecord<TestConfig, TestElement>) => child.tagName,
							)
							expect(childTags).toEqual(expectedNode.children)
						}
					}
				} finally {
					await cleanup()
				}
			})
		}
	})

	describe('hook integration', () => {
		type TestCase = {
			description: string
			operations?: Array<ChainTestOperation<TestConfig, TestElement, TestChildElement>>
			sourceSelector: FromElementParams<TestConfig, TestElement>
			targetSelector: FromElementParams<TestConfig, TestElement>
			hookConfig: Pick<DialecteHooks, 'beforeClone'>
			expected: {
				clonedElements: TestElement[]
				skippedElements: TestElement[]
			}
		}

		const testCases: TestCase[] = [
			{
				description: 'beforeClone hook skips elements',
				operations: [
					{
						type: 'addChild',
						goTo: { tagName: 'A' },
						tagName: 'AA_1',
						attributes: {
							aA: 'value-AA1',
						},
						setFocus: false,
					},
					{
						type: 'addChild',
						tagName: 'AA_2',
						attributes: {
							aA: 'value-AA2',
						},
						setFocus: false,
					},
				],
				sourceSelector: { tagName: 'A' },
				targetSelector: { tagName: 'C' },
				hookConfig: {
					beforeClone: ({ record }) => {
						if (record.tagName === 'AA_1') {
							return { shouldBeCloned: false, transformedRecord: record }
						}
						return { shouldBeCloned: true, transformedRecord: record }
					},
				},
				expected: {
					clonedElements: ['A', 'AA_2'],
					skippedElements: ['AA_1'],
				},
			},
			{
				description: 'beforeClone hook transforms attributes',
				operations: [
					{
						type: 'update',
						goTo: { tagName: 'A' },
						attributes: [{ name: 'aA', value: 'original-uuid', namespace: undefined }],
					},
					{
						type: 'addChild',
						tagName: 'AA_1',
						attributes: { aA: 'child-uuid' },
						setFocus: false,
					},
				],
				sourceSelector: { tagName: 'A' },
				targetSelector: { tagName: 'C' },
				hookConfig: {
					beforeClone: ({ record }) => {
						const filteredAttributes = record.attributes.filter(
							(attribute) => attribute.name !== 'aA',
						)
						return {
							shouldBeCloned: true,
							transformedRecord: { ...record, attributes: filteredAttributes },
						}
					},
				},
				expected: {
					clonedElements: ['A', 'AA_1'],
					skippedElements: [],
				},
			},
		]

		testCases.forEach(testHookIntegration)

		function testHookIntegration(testCase: TestCase) {
			it(testCase.description, async () => {
				// Arrange
				const customConfig = {
					...TEST_DIALECTE_CONFIG,
					hooks: testCase.hookConfig,
				}

				const { dialecte, cleanup } = await createTestDialecte({
					xmlString,
					dialecteConfig: customConfig,
				})

				try {
					if (testCase.operations) {
						await executeChainOperations<TestConfig, TestElement, TestChildElement>({
							chain: dialecte.fromRoot() as Chain<TestConfig, TestElement>,
							operations: testCase.operations,
						})
					}

					const sourceChain = dialecte.fromElement(testCase.sourceSelector)
					const sourceRecord = await sourceChain.getTree()

					const targetChain = dialecte.fromElement(testCase.targetSelector)

					// Act
					const resultChain = targetChain.deepCloneChild({
						record: sourceRecord as TreeRecord<TestConfig, 'A'>,
						setFocus: true,
					})

					await resultChain.commit()

					// Assert - Verify cloned and skipped elements
					const targetTree = await dialecte.fromElement(testCase.targetSelector).getTree()

					function findAllTagNames(tree: TreeRecord<TestConfig, TestElement>[]): TestElement[] {
						const tags: TestElement[] = []
						for (const node of tree) {
							tags.push(node.tagName)
							if (node.tree.length > 0) {
								tags.push(...findAllTagNames(node.tree))
							}
						}
						return tags
					}

					const allClonedTags = findAllTagNames(targetTree.tree)

					for (const expectedTag of testCase.expected.clonedElements) {
						expect(
							allClonedTags.includes(expectedTag),
							`Expected ${expectedTag} to be cloned`,
						).toBe(true)
					}

					for (const skippedTag of testCase.expected.skippedElements) {
						expect(allClonedTags.includes(skippedTag), `Expected ${skippedTag} to be skipped`).toBe(
							false,
						)
					}
				} finally {
					await cleanup()
				}
			})
		}
	})
})
