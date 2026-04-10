import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestDialecte,
	runXmlTestCases,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecords', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			refs: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>[]
			expectedResults: ({ id: string; tagName: string; status: 'unchanged' } | undefined)[]
		}

		const testCases: TestCases<TestCase> = {
			'returns empty array for empty refs': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				refs: [],
				expectedResults: [],
			},
			'returns a single found record': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				refs: [{ tagName: 'A', id: 'a1' }],
				expectedResults: [{ id: 'a1', tagName: 'A', status: 'unchanged' }],
			},
			'returns undefined for a missing ref': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				refs: [{ tagName: 'A', id: 'non-existent' }],
				expectedResults: [undefined],
			},
			'preserves order of results matching order of refs': {
				sourceXml: /* xml */ `
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
			'mixes found and undefined for partial matches': {
				sourceXml: /* xml */ `
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
			'resolves refs of different tagNames': {
				sourceXml: /* xml */ `
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
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const results = await source.document.query.getRecords(testCase.refs)

			expect(results).toHaveLength(testCase.expectedResults.length)

			for (let i = 0; i < testCase.expectedResults.length; i++) {
				const expected = testCase.expectedResults[i]
				if (expected === undefined) {
					expect(results[i]).toBeUndefined()
				} else {
					expect(results[i]).toMatchObject(expected)
				}
			}
		}

		runXmlTestCases({ testCases, act })
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
