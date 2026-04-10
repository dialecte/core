import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestDialecte,
	runTestCases,
} from '@/test'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('findAncestors', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			ref: Ref<TestDialecteConfig, 'AA_1' | 'AAA_1' | 'AAAA_1' | 'A'>
			expectedTagNames: string[]
			options?: FindAncestorsOptions<TestDialecteConfig>
		}

		const xml = /* xml */ `
			<Root ${ns}>
				<A ${customId}="a1" aA="v">
					<AA_1 ${customId}="aa1" aAA_1="v">
						<AAA_1 ${customId}="aaa1" aAAA_1="v">
							<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
						</AAA_1>
					</AA_1>
				</A>
			</Root>
		`

		const testCases: TestCases<TestCase> = {
			'returns full ancestor chain bottom-up': {
				sourceXml: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				expectedTagNames: ['AAA_1', 'AA_1', 'A', 'Root'],
			},
			'returns empty array for root element': {
				sourceXml: xml,
				ref: { tagName: 'A', id: 'a1' } as Ref<TestDialecteConfig, 'A'>,
				expectedTagNames: ['Root'],
			},
			'respects depth limit': {
				sourceXml: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				options: { depth: 2 },
				expectedTagNames: ['AAA_1', 'AA_1'],
			},
			'stops at specified tag name (inclusive)': {
				sourceXml: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				options: { stopAtTagName: 'A' },
				expectedTagNames: ['AAA_1', 'AA_1', 'A'],
			},
			'returns empty array when ref does not exist': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				ref: { tagName: 'AAAA_1', id: 'non-existent' },
				expectedTagNames: [],
			},
			'depth=1 returns only direct parent': {
				sourceXml: xml,
				ref: { tagName: 'AAA_1', id: 'aaa1' },
				options: { depth: 1 },
				expectedTagNames: ['AA_1'],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const ancestors = await source.document.query.findAncestors(testCase.ref, testCase.options)

			expect(ancestors.map((a) => a.tagName)).toEqual(testCase.expectedTagNames)
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('reflects staged parent updates in ancestor walk', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="old">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })

					const ancestors = await tx.findAncestors({ tagName: 'AA_1', id: 'aa1' })

					expect(ancestors).toHaveLength(2)
					expect(ancestors[0].tagName).toBe('A')

					const aAttr = ancestors[0].attributes.find((a) => a.name === 'aA')
					expect(aAttr?.value).toBe('new')
				})
			} finally {
				await cleanup()
			}
		})

		it('returns staged created child ancestors', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v" />
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const ancestors = await tx.findAncestors({ tagName: 'AA_1', id: '0-0-0-0-1' })

					expect(ancestors.map((a) => a.tagName)).toEqual(['A', 'Root'])
				})
			} finally {
				await cleanup()
			}
		})
	})
})
