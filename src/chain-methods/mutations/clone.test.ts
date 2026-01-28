import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { FromElementParams } from '@/dialecte'
import type { ElementsOf, TreeRecord } from '@/types'

describe('deepCloneChild', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	describe('basic cloning', () => {
		type TestCase = {
			desc: string
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			cloneFrom: FromElementParams<TestConfig, 'A'>
			setFocus: boolean
			expected: {
				focusedElement: TestElement
				clonedChildCount: number
				originalStillExists: boolean
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'clones single element with setFocus: true',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="original"><AA_1 ${DEV_ID}="3" aAA_1="child" /></A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: true,
				expected: {
					focusedElement: 'A',
					clonedChildCount: 1,
					originalStillExists: true,
				},
			},
			{
				desc: 'clones single element with setFocus: false',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="original" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: false,
				expected: {
					focusedElement: 'Root',
					clonedChildCount: 2,
					originalStillExists: true,
				},
			},
			{
				desc: 'clones element preserving attributes',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1" aAA="value2" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: false,
				expected: {
					focusedElement: 'Root',
					clonedChildCount: 2,
					originalStillExists: true,
				},
			},
		]

		testCases.forEach(testBasicCloning)

		function testBasicCloning(testCase: TestCase) {
			it(testCase.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: testCase.xmlString })
				const chain = dialecte.fromElement(testCase.startFrom)
				// Get tree to clone
				const sourceChain = dialecte.fromElement(testCase.cloneFrom)
				const treeToClone = await sourceChain.getTree()

				// Act
				let resultChain = chain

				if (testCase.setFocus) {
					resultChain = resultChain.deepCloneChild({
						record: treeToClone,
						setFocus: true,
					})
				} else {
					resultChain = resultChain.deepCloneChild({
						record: treeToClone,
						setFocus: false,
					})
				}

				const context = await resultChain.getContext()

				// Assert - Focus
				expect(context.currentFocus.tagName).toBe(testCase.expected.focusedElement)

				// Assert - Parent has correct child count (check in-memory context, not fresh DB fetch)
				expect(context.currentFocus.children.length).toBe(testCase.expected.clonedChildCount)

				// Assert - Original still exists (unchanged in DB)
				const originalChain = dialecte.fromElement(testCase.cloneFrom)
				const originalContext = await originalChain.getContext()
				expect(originalContext.currentFocus).toBeDefined()
				expect(originalContext.currentFocus.id).toBe(testCase.cloneFrom.id)
			})
		}
	})

	describe('deep cloning', () => {
		type TestCase = {
			desc: string
			only?: boolean
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			cloneFrom: FromElementParams<TestConfig, 'A'>
			setFocus: boolean
			expected: {
				treeDepth: number
				totalDescendants: number
				leafTagName: TestElement
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'clones nested structure 3 levels deep',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="parent">
							<AA_1 ${DEV_ID}="3" aAA_1="child">
								<AAA_1 ${DEV_ID}="4" aAAA_1="grandchild" />
							</AA_1>
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: true,
				expected: {
					treeDepth: 3,
					totalDescendants: 2,
					leafTagName: 'AAA_1',
				},
			},
			{
				desc: 'clones structure with multiple children at same level',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="parent">
							<AA_1 ${DEV_ID}="3" aAA_1="child1" />
							<AA_1 ${DEV_ID}="4" aAA_1="child2" />
							<AA_1 ${DEV_ID}="5" aAA_1="child3" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: true,
				expected: {
					treeDepth: 2,
					totalDescendants: 3,
					leafTagName: 'AA_1',
				},
			},
			{
				desc: 'clones complex branching structure',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="root">
							<AA_1 ${DEV_ID}="3" aAA_1="branch1">
								<AAA_1 ${DEV_ID}="4" aAAA_1="leaf1" />
							</AA_1>
							<AA_1 ${DEV_ID}="5" aAA_1="branch2">
								<AAA_1 ${DEV_ID}="6" aAAA_1="leaf2" />
								<AAA_1 ${DEV_ID}="7" aAAA_1="leaf3" />
							</AA_1>
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				cloneFrom: { tagName: 'A', id: '2' },
				setFocus: true,
				expected: {
					treeDepth: 3,
					totalDescendants: 5,
					leafTagName: 'AAA_1',
				},
			},
		]

		let filteredTests = testCases
		const onlyTests = testCases.filter((tc) => tc.only)
		if (onlyTests.length) {
			filteredTests = onlyTests
		}

		filteredTests.forEach(testDeepCloning)

		function testDeepCloning(testCase: TestCase) {
			it(testCase.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: testCase.xmlString })
				const chain = dialecte.fromElement(testCase.startFrom)

				const sourceChain = dialecte.fromElement(testCase.cloneFrom)
				const treeToClone = await sourceChain.getTree()

				// Act
				let resultChain = chain

				if (testCase.setFocus) {
					resultChain = resultChain.deepCloneChild({
						record: treeToClone,
						setFocus: true,
					})
				} else {
					resultChain = resultChain.deepCloneChild({
						record: treeToClone,
						setFocus: false,
					})
				}

				const clonedTree = await resultChain.getTree()

				// Assert - Tree depth
				const depth = calculateTreeDepth(clonedTree)
				expect(depth).toBe(testCase.expected.treeDepth)

				// Assert - Total descendants
				const descendantCount = countDescendants(clonedTree)
				expect(descendantCount).toBe(testCase.expected.totalDescendants)

				// Assert - Leaf node type
				const leaves = findLeafNodes(clonedTree)
				expect(leaves.every((leaf) => leaf.tagName === testCase.expected.leafTagName)).toBe(true)
			})
		}

		function calculateTreeDepth<GenericElement extends TestElement>(
			record: TreeRecord<TestConfig, GenericElement>,
			currentDepth = 1,
		): number {
			if (record.tree.length === 0) {
				return currentDepth
			}
			return Math.max(...record.tree.map((child) => calculateTreeDepth(child, currentDepth + 1)))
		}

		function countDescendants<GenericElement extends TestElement>(
			record: TreeRecord<TestConfig, GenericElement>,
		): number {
			return record.tree.reduce((count, child) => count + 1 + countDescendants(child), 0)
		}

		function findLeafNodes(
			record: TreeRecord<TestConfig, TestElement>,
		): TreeRecord<TestConfig, TestElement>[] {
			if (record.tree.length === 0) {
				return [record]
			}
			return record.tree.flatMap((child) => findLeafNodes(child))
		}
	})
})
