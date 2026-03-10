import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test-fixtures'

import type { TestDialecteConfig } from '@/test-fixtures'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecords', () => {
	describe('store reads', () => {
		type TestCase = {
			description: string
			xmlString: string
			refs: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>[]
			expectedResults: ({ id: string; tagName: string; status: 'unchanged' } | undefined)[]
		}

		const testCases: TestCase[] = [
			{
				description: 'returns empty array for empty refs',
				xmlString: /* xml */ `<Root ${ns} />`,
				refs: [],
				expectedResults: [],
			},
			{
				description: 'returns a single found record',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				refs: [{ tagName: 'A', id: 'a1' }],
				expectedResults: [{ id: 'a1', tagName: 'A', status: 'unchanged' }],
			},
			{
				description: 'returns undefined for a missing ref',
				xmlString: /* xml */ `<Root ${ns} />`,
				refs: [{ tagName: 'A', id: 'non-existent' }],
				expectedResults: [undefined],
			},
			{
				description: 'preserves order of results matching order of refs',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="first" />
						<A ${customId}="a2" aA="second" />
						<A ${customId}="a3" aA="third" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a3' },
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				expectedResults: [
					{ id: 'a3', tagName: 'A', status: 'unchanged' },
					{ id: 'a1', tagName: 'A', status: 'unchanged' },
					{ id: 'a2', tagName: 'A', status: 'unchanged' },
				],
			},
			{
				description: 'mixes found and undefined for partial matches',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'missing' },
				],
				expectedResults: [{ id: 'a1', tagName: 'A', status: 'unchanged' }, undefined],
			},
			{
				description: 'resolves refs of different tagNames',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
						<B ${customId}="b1" aB="v" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'B', id: 'b1' },
				],
				expectedResults: [
					{ id: 'a1', tagName: 'A', status: 'unchanged' },
					{ id: 'b1', tagName: 'B', status: 'unchanged' },
				],
			},
		]

		it.each(testCases)('$description', async ({ xmlString, refs, expectedResults }) => {
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				const results = await document.query.getRecords(refs)

				expect(results).toHaveLength(expectedResults.length)

				for (let i = 0; i < expectedResults.length; i++) {
					const expected = expectedResults[i]
					if (expected === undefined) {
						expect(results[i]).toBeUndefined()
					} else {
						expect(results[i]).toMatchObject(expected)
					}
				}
			} finally {
				await cleanup()
			}
		})
	})

	describe('staged operation visibility', () => {
		it('sees staged created record in batch', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="p" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const [existing, created] = await tx.getRecords([
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1' },
					])

					expect(existing).toBeDefined()
					expect(created?.status).toBe('created')
				})
			} finally {
				await cleanup()
			}
		})

		it('returns undefined for staged deleted record in batch', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="p">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const [deleted] = await tx.getRecords([{ tagName: 'AA_1', id: 'aa1' }])

					expect(deleted).toBeUndefined()
				})
			} finally {
				await cleanup()
			}
		})
	})
})
