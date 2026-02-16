import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { DescendantsFilter } from './types'
import type { FromElementParams } from '@/dialecte'
import type { ElementsOf } from '@/types'

describe('findDescendantsAsTree', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>

	type TestCase = {
		description: string
		xml: string
		startFrom: FromElementParams<TestConfig, TestElement>
		filter: DescendantsFilter<TestConfig>
		expected: {
			rootCount: number
			structure: {
				id: string
				tagName: string
				childrenIds?: string[]
			}[]
		}
	}

	const testCases: TestCase[] = [
		{
			description: 'stops tree at deepest element',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
					<A ${DEV_ID}="2" aA="a1">
						<AA_1 ${DEV_ID}="3" aAA_1="aa1">
							<ShouldNotBeIncluded ${DEV_ID}="999" />
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
				},
			},
			expected: {
				rootCount: 1,
				structure: [
					{
						id: '2',
						tagName: 'A',
						childrenIds: ['3'],
					},
					{
						id: '3',
						tagName: 'AA_1',
						childrenIds: [], // Deepest element - tree should be empty
					},
				],
			},
		},
		{
			description: 'handles optional intermediates - no AA_1',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
					<A ${DEV_ID}="2" aA="a1">
						<AAA_1 ${DEV_ID}="3" aAAA_1="aaa1" />
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				rootCount: 1,
				structure: [
					{
						id: '2',
						tagName: 'A',
						childrenIds: ['3'],
					},
					{
						id: '3',
						tagName: 'AAA_1',
						childrenIds: [],
					},
				],
			},
		},
		{
			description: 'handles optional intermediates - one AA_1',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
					<A ${DEV_ID}="2" aA="a1">
						<AA_1 ${DEV_ID}="3" aAA_1="aa1">
							<AAA_1 ${DEV_ID}="4" aAAA_1="aaa1" />
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				rootCount: 1,
				structure: [
					{
						id: '2',
						tagName: 'A',
						childrenIds: ['3'],
					},
					{
						id: '3',
						tagName: 'AA_1',
						childrenIds: ['4'],
					},
					{
						id: '4',
						tagName: 'AAA_1',
						childrenIds: [],
					},
				],
			},
		},
		{
			description: 'handles optional intermediates - nested AA_1',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
					<A ${DEV_ID}="2" aA="a1">
						<AA_1 ${DEV_ID}="3" aAA_1="aa1">
							<AA_1 ${DEV_ID}="4" aAA_1="aa2">
								<AA_1 ${DEV_ID}="5" aAA_1="aa3">
									<AAA_1 ${DEV_ID}="6" aAAA_1="aaa1" />
								</AA_1>
							</AA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				rootCount: 1,
				structure: [
					{
						id: '2',
						tagName: 'A',
						childrenIds: ['3'],
					},
					{
						id: '3',
						tagName: 'AA_1',
						childrenIds: ['4'],
					},
					{
						id: '4',
						tagName: 'AA_1',
						childrenIds: ['5'],
					},
					{
						id: '5',
						tagName: 'AA_1',
						childrenIds: ['6'],
					},
					{
						id: '6',
						tagName: 'AAA_1',
						childrenIds: [],
					},
				],
			},
		},
		{
			description: 'handles mixed depths across multiple branches',
			xml: /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
					<A ${DEV_ID}="2" aA="a1">
						<AAA_1 ${DEV_ID}="3" aAAA_1="aaa1" />
					</A>
					<A ${DEV_ID}="4" aA="a2">
						<AA_1 ${DEV_ID}="5" aAA_1="aa1">
							<AAA_1 ${DEV_ID}="6" aAAA_1="aaa2" />
						</AA_1>
					</A>
					<A ${DEV_ID}="7" aA="a3">
						<AA_1 ${DEV_ID}="8" aAA_1="aa2">
							<AA_1 ${DEV_ID}="9" aAA_1="aa3">
								<AAA_1 ${DEV_ID}="10" aAAA_1="aaa3" />
							</AA_1>
						</AA_1>
					</A>
				</Root>
			`,
			startFrom: { tagName: 'Root', id: '1' },
			filter: {
				tagName: 'A',
				descendant: {
					tagName: 'AA_1',
					descendant: {
						tagName: 'AAA_1',
					},
				},
			},
			expected: {
				rootCount: 3,
				structure: [
					// Tree 1: Direct A -> AAA_1
					{ id: '2', tagName: 'A', childrenIds: ['3'] },
					{ id: '3', tagName: 'AAA_1', childrenIds: [] },
					// Tree 2: A -> AA_1 -> AAA_1
					{ id: '4', tagName: 'A', childrenIds: ['5'] },
					{ id: '5', tagName: 'AA_1', childrenIds: ['6'] },
					{ id: '6', tagName: 'AAA_1', childrenIds: [] },
					// Tree 3: A -> AA_1 -> AA_1 -> AAA_1
					{ id: '7', tagName: 'A', childrenIds: ['8'] },
					{ id: '8', tagName: 'AA_1', childrenIds: ['9'] },
					{ id: '9', tagName: 'AA_1', childrenIds: ['10'] },
					{ id: '10', tagName: 'AAA_1', childrenIds: [] },
				],
			},
		},
	]

	testCases.forEach(({ description, xml, startFrom, filter, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const results = await dialecte.fromElement(startFrom).findDescendantsAsTree(filter)

				// Verify root count
				expect(results.length, 'root count').toBe(expected.rootCount)

				// Flatten trees to check structure
				const flatStructure: { id: string; tagName: string; childrenIds: string[] }[] = []

				function flatten(tree: (typeof results)[0]) {
					flatStructure.push({
						id: tree.id,
						tagName: tree.tagName,
						childrenIds: tree.tree.map((t) => t.id),
					})
					tree.tree.forEach((child) => flatten(child))
				}

				results.forEach((tree) => flatten(tree))

				// Verify structure
				expect(flatStructure.length, 'total nodes').toBe(expected.structure.length)

				for (let i = 0; i < expected.structure.length; i++) {
					const expectedNode = expected.structure[i]
					const actualNode = flatStructure.find((n) => n.id === expectedNode.id)

					expect(actualNode, `node ${expectedNode.id} exists`).toBeDefined()
					expect(actualNode!.tagName, `node ${expectedNode.id} tagName`).toBe(expectedNode.tagName)

					if (expectedNode.childrenIds !== undefined) {
						expect(actualNode!.childrenIds, `node ${expectedNode.id} children`).toEqual(
							expectedNode.childrenIds,
						)
					}
				}
			} finally {
				await cleanup()
			}
		})
	})
})
