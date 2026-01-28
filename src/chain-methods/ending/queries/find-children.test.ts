import { describe, it, expect } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	createTestDialecte,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { FindChildrenParams } from './find-children.types'
import type { FromElementParams } from '@/dialecte'
import type { ElementsOf, ChildrenOf } from '@/types'

describe('findChildren', () => {
	type TestConfig = typeof TEST_DIALECTE_CONFIG
	type TestElement = ElementsOf<TestConfig>
	type ChildElement = ChildrenOf<TestConfig, TestElement>
	type TestCase = {
		description: string
		xml: string
		startFrom: FromElementParams<TestConfig, TestElement>
		filters: FindChildrenParams<TestConfig, TestElement, ChildElement>
		expected: Record<string, { count: number; ids?: string[] }>
	}

	const testCases: TestCase[] = [
		{
			description: 'finds single child by tagName',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="child" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: {} },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
			},
		},
		{
			description: 'finds multiple children of same tagName',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="c1" /><AA_1 ${DEV_ID}="4" aAA_1="c2" /><AA_1 ${DEV_ID}="5" aAA_1="c3" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: {} },
			expected: {
				AA_1: { count: 3, ids: ['3', '4', '5'] },
			},
		},
		{
			description: 'finds children filtered by attribute',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="match" /><AA_1 ${DEV_ID}="4" aAA_1="nomatch" /><AA_1 ${DEV_ID}="5" aAA_1="match" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: { aAA_1: 'match' } },
			expected: {
				AA_1: { count: 2, ids: ['3', '5'] },
			},
		},
		{
			description: 'finds children of different tagNames',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="c1" /><AA_2 ${DEV_ID}="4" aAA_2="c2" /><AA_3 ${DEV_ID}="5" aAA_3="c3" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: {}, AA_2: {}, AA_3: {} },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
				AA_2: { count: 1, ids: ['4'] },
				AA_3: { count: 1, ids: ['5'] },
			},
		},
		{
			description: 'finds children with different attribute filters',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="a1" bAA_1="b1" /><AA_1 ${DEV_ID}="4" aAA_1="a2" bAA_1="b2" /><AA_2 ${DEV_ID}="5" aAA_2="a3" bAA_2="b3" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: { aAA_1: 'a1' }, AA_2: { bAA_2: 'b3' } },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
				AA_2: { count: 1, ids: ['5'] },
			},
		},
		{
			description: 'returns empty array when no children match',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="nomatch" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: { aAA_1: 'match' } },
			expected: {
				AA_1: { count: 0 },
			},
		},
		{
			description: 'returns empty array when element has no children',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value" /></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: {} },
			expected: {
				AA_1: { count: 0 },
			},
		},
		{
			description: 'finds children with multiple attribute filters',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="a1" bAA_1="b1" /><AA_1 ${DEV_ID}="4" aAA_1="a1" bAA_1="b2" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: { aAA_1: 'a1', bAA_1: 'b1' } },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
			},
		},
		{
			description: 'excludes grandchildren from results',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="child"><AAA_1 ${DEV_ID}="4" aAAA_1="grandchild" /></AA_1></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: {} },
			expected: {
				AA_1: { count: 1, ids: ['3'] },
			},
		},
		{
			description: 'finds children when filtering by array attribute',
			xml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="opt1" /><AA_1 ${DEV_ID}="4" aAA_1="opt2" /><AA_1 ${DEV_ID}="5" aAA_1="opt3" /></A></Root>`,
			startFrom: { tagName: 'A', id: '2' },
			filters: { AA_1: { aAA_1: ['opt1', 'opt3'] } },
			expected: {
				AA_1: { count: 2, ids: ['3', '5'] },
			},
		},
	]

	testCases.forEach(({ description, xml, startFrom, filters, expected }) => {
		it(description, async () => {
			const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

			try {
				const results = await dialecte.fromElement(startFrom).findChildren(filters)

				for (const [tagName, expectedData] of Object.entries(expected)) {
					const tagResults = results[tagName as ChildElement] || []
					expect(tagResults.length).toBe(expectedData.count)

					if (expectedData.ids) {
						const resultIds = tagResults.map((record) => record.id).sort()
						expect(resultIds).toEqual([...expectedData.ids].sort())
					}
				}
			} finally {
				await cleanup()
			}
		})
	})

	it('includes status property on returned records', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="child" /></A></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const results = await dialecte
				.fromElement({ tagName: 'A', id: '2' })
				.findChildren({ AA_1: {} })

			expect(results.AA_1.length).toBe(1)
			expect(results.AA_1[0]).toHaveProperty('status')
			expect(results.AA_1[0].status).toBe('unchanged')
		} finally {
			await cleanup()
		}
	})

	it('finds newly created children from staged operations', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="existing" /></A></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const results = await dialecte
				.fromElement({ tagName: 'A', id: '2' })
				.addChild({ id: '0-0-0-0-1', tagName: 'AA_1', attributes: { aAA_1: 'created' } })
				.findChildren({ AA_1: {} })

			expect(results.AA_1.length).toBe(2)
			expect(results.AA_1.map((r) => r.id).sort()).toEqual(['3', '0-0-0-0-1'].sort())
			expect(results.AA_1.find((r) => r.id === '3')?.status).toBe('unchanged')
			expect(results.AA_1.find((r) => r.id === '0-0-0-0-1')?.status).toBe('created')
		} finally {
			await cleanup()
		}
	})

	it('excludes deleted children from results', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="c1" /><AA_1 ${DEV_ID}="4" aAA_1="c2" /></A></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const results = await dialecte
				.fromElement({ tagName: 'A', id: '2' })
				.goToElement({ tagName: 'AA_1', id: '3' })
				.delete()
				.findChildren({ AA_1: {} })

			expect(results.AA_1.length).toBe(1)
			expect(results.AA_1[0].id).toBe('4')
		} finally {
			await cleanup()
		}
	})

	it('finds updated children with new attribute values', async () => {
		const xml = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A ${DEV_ID}="2" aA="value"><AA_1 ${DEV_ID}="3" aAA_1="old" /></A></Root>`
		const { dialecte, cleanup } = await createTestDialecte({ xmlString: xml })

		try {
			const results = await dialecte
				.fromElement({ tagName: 'A', id: '2' })
				.goToElement({ tagName: 'AA_1', id: '3' })
				.update({ attributes: { aAA_1: 'new' } })
				.goToParent()
				.findChildren({ AA_1: { aAA_1: 'new' } })

			expect(results.AA_1.length).toBe(1)
			expect(results.AA_1[0].id).toBe('3')
			expect(results.AA_1[0].status).toBe('updated')
			expect(results.AA_1[0].attributes[0].value).toBe('new')
		} finally {
			await cleanup()
		}
	})
})
