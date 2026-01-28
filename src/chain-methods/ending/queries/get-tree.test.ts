import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { GetTreeParams } from './get-tree.types'
import type { FromElementParams } from '@/dialecte'
import type { ElementsOf } from '@/types'

describe('getTree', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	describe('include filter', () => {
		type TestCase = {
			desc: string
			only?: boolean
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			options: GetTreeParams<TestConfig, TestElement>
			expected: {
				childCount: number
				structure?: {
					tagName: TestElement
					childCount: number
				}[]
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'includes only matching tagName',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1"><AA_1 ${DEV_ID}="5" aAA_1="valueA" /></A>
						<B ${DEV_ID}="3" bB="value2" />
						<A ${DEV_ID}="4" aA="value3" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
						children: [{ tagName: 'AA_1' }],
					},
				},
				expected: {
					childCount: 2,
				},
			},
			{
				desc: 'includes only matching attributes',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="match" />
						<A ${DEV_ID}="3" aA="nomatch" />
						<A ${DEV_ID}="4" aA="match" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
						attributes: { aA: 'match' },
					},
				},
				expected: {
					childCount: 2,
				},
			},
			{
				desc: 'includes nested children',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<AA_1 ${DEV_ID}="3" bB="value2">
								<AAA_1 ${DEV_ID}="4" cC="target" />
							</AA_1>
						</A>
						<B ${DEV_ID}="5" bA="value5">
							<BB_1 ${DEV_ID}="6" bB="value6" />
						</B>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
						children: [
							{
								tagName: 'AA_1',
								children: [{ tagName: 'AAA_1' }],
							},
						],
					},
				},
				expected: {
					childCount: 1,
					structure: [
						{
							tagName: 'A',
							childCount: 1,
						},
					],
				},
			},
			{
				desc: 'handles multiple descendant branches for different sibling types',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<AA_1 ${DEV_ID}="3" aAA_1="valueA">
								<AAA_1 ${DEV_ID}="4" aAAA_1="deep" />
							</AA_1>
							<AA_2 ${DEV_ID}="5" aAA_2="valueB" />
						</A>
						<A ${DEV_ID}="6" aA="value2">
							<AA_1 ${DEV_ID}="7" aAA_1="valueC" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
						children: [
							{
								tagName: 'AA_1',
								children: [{ tagName: 'AAA_1' }],
							},
							{
								tagName: 'AA_2',
							},
						],
					},
				},
				expected: {
					childCount: 2,
					structure: [
						{
							tagName: 'A',
							childCount: 2, // Both AA_1 and AA_2
						},
						{
							tagName: 'A',
							childCount: 1, // Only AA_1
						},
					],
				},
			},
		]

		let cases = testCases
		const onlyCases = testCases.filter((tc) => tc.only)
		if (onlyCases.length) cases = onlyCases

		cases.forEach(runTest)

		async function runTest(tc: TestCase) {
			it(tc.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: tc.xmlString })

				// Act
				const tree = await dialecte.fromElement(tc.startFrom).getTree(tc.options)

				// Assert
				expect(tree.tree).toHaveLength(tc.expected.childCount)

				if (tc.expected.structure) {
					tc.expected.structure.forEach((expected, index) => {
						const child = tree.tree[index]
						expect(child.tagName).toBe(expected.tagName)
						expect(child.tree).toHaveLength(expected.childCount)
					})
				}
			})
		}
	})

	describe('exclude filter', () => {
		type TestCase = {
			desc: string
			only?: boolean
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			options: GetTreeParams<TestConfig, TestElement>
			expected: {
				childCount: number
				structure?: {
					tagName: TestElement
					childCount: number
				}[]
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'excludes matching elements with scope: self',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1" />
						<B ${DEV_ID}="3" bB="value2" />
						<A ${DEV_ID}="4" aA="value3" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					exclude: [{ tagName: 'A', scope: 'self' }],
				},
				expected: {
					childCount: 1, // Only B remains
				},
			},
			{
				desc: 'stops traversal with scope: children',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<B ${DEV_ID}="3" bB="value2" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					exclude: [{ tagName: 'A', scope: 'children' }],
				},
				expected: {
					childCount: 1, // A is kept
					structure: [
						{
							tagName: 'A',
							childCount: 0, // But its children are not traversed
						},
					],
				},
			},
			{
				desc: 'excludes with attribute matching',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="exclude" />
						<A ${DEV_ID}="3" aA="keep" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					exclude: [{ tagName: 'A', attributes: { aA: 'exclude' }, scope: 'self' }],
				},
				expected: {
					childCount: 1, // Only second A
				},
			},
		]

		let cases = testCases
		const onlyCases = testCases.filter((tc) => tc.only)
		if (onlyCases.length) cases = onlyCases

		cases.forEach(runTest)

		async function runTest(tc: TestCase) {
			it(tc.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: tc.xmlString })

				// Act
				const tree = await dialecte.fromElement(tc.startFrom).getTree(tc.options)

				// Assert
				expect(tree.tree).toHaveLength(tc.expected.childCount)

				if (tc.expected.structure) {
					tc.expected.structure.forEach((expected, index) => {
						const child = tree.tree[index]
						expect(child.tagName).toBe(expected.tagName)
						expect(child.tree).toHaveLength(expected.childCount)
					})
				}
			})
		}
	})

	describe('unwrap filter', () => {
		type TestCase = {
			desc: string
			only?: boolean
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			options: GetTreeParams<TestConfig, TestElement>
			expected: {
				childCount: number
				childTagNames: TestElement[]
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'unwraps matching elements and promotes children',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<B ${DEV_ID}="3" bB="value2" />
							<C ${DEV_ID}="4" cC="value3" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					unwrap: ['A'],
				},
				expected: {
					childCount: 2, // B and C promoted to Root
					childTagNames: ['B', 'C'],
				},
			},
			{
				desc: 'unwraps multiple elements at same level',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<C ${DEV_ID}="3" cC="value3" />
						</A>
						<A ${DEV_ID}="4" aA="value2">
							<C ${DEV_ID}="5" cC="value4" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					unwrap: ['A'],
				},
				expected: {
					childCount: 2, // Two C elements promoted
					childTagNames: ['C', 'C'],
				},
			},
			{
				desc: 'unwraps nested elements recursively',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<B ${DEV_ID}="3" bB="value2">
								<C ${DEV_ID}="4" cC="value3" />
							</B>
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					unwrap: ['A', 'B'],
				},
				expected: {
					childCount: 1, // C promoted all the way to Root
					childTagNames: ['C'],
				},
			},
		]

		let cases = testCases
		const onlyCases = testCases.filter((tc) => tc.only)
		if (onlyCases.length) cases = onlyCases

		cases.forEach(runTest)

		async function runTest(tc: TestCase) {
			it(tc.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: tc.xmlString })

				// Act
				const tree = await dialecte.fromElement(tc.startFrom).getTree(tc.options)

				// Assert
				expect(tree.tree).toHaveLength(tc.expected.childCount)
				const actualTagNames = tree.tree.map((child) => child.tagName)
				expect(actualTagNames).toEqual(tc.expected.childTagNames)
			})
		}
	})

	describe('combined filters', () => {
		type TestCase = {
			desc: string
			only?: boolean
			xmlString: string
			startFrom: FromElementParams<TestConfig, TestElement>
			options: GetTreeParams<TestConfig, TestElement>
			expected: {
				childCount: number
				childTagNames?: TestElement[]
			}
		}

		const testCases: TestCase[] = [
			{
				desc: 'combines include and exclude filters',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="keep" />
						<A ${DEV_ID}="3" aA="exclude" />
						<B ${DEV_ID}="4" bB="value" />
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
					},
					exclude: [{ tagName: 'A', attributes: { aA: 'exclude' }, scope: 'self' }],
				},
				expected: {
					childCount: 1, // Only A with aA="keep"
				},
			},
			{
				desc: 'combines all three filters',
				xmlString: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A ${DEV_ID}="2" aA="value1">
							<AA_1 ${DEV_ID}="3" bB="value2" />
						</A>
					</Root>
				`,
				startFrom: { tagName: 'Root', id: '1' },
				options: {
					include: {
						tagName: 'A',
						children: [{ tagName: 'AA_1' }],
					},
					unwrap: ['A'],
				},
				expected: {
					childCount: 1, // AA_1 promoted to Root
					childTagNames: ['AA_1'],
				},
			},
		]

		let cases = testCases
		const onlyCases = testCases.filter((tc) => tc.only)
		if (onlyCases.length) cases = onlyCases

		cases.forEach(runTest)

		async function runTest(tc: TestCase) {
			it(tc.desc, async () => {
				// Arrange
				const { dialecte } = await createTestDialecte({ xmlString: tc.xmlString })

				// Act
				const tree = await dialecte.fromElement(tc.startFrom).getTree(tc.options)

				// Assert
				expect(tree.tree).toHaveLength(tc.expected.childCount)

				if (tc.expected.childTagNames) {
					const actualTagNames = tree.tree.map((child) => child.tagName)
					expect(actualTagNames).toEqual(tc.expected.childTagNames)
				}
			})
		}
	})
})
