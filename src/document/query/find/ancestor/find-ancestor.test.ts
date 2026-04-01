import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { TestDialecteConfig } from '@/test'
import type { Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('findAncestors', () => {
	describe('store reads', () => {
		type TestCase = {
			xmlString: string
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

		const testCases: Record<string, TestCase> = {
			'returns full ancestor chain bottom-up': {
				xmlString: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				expectedTagNames: ['AAA_1', 'AA_1', 'A', 'Root'],
			},
			'returns empty array for root element': {
				xmlString: xml,
				ref: { tagName: 'A', id: 'a1' } as Ref<TestDialecteConfig, 'A'>,
				expectedTagNames: ['Root'],
			},
			'respects depth limit': {
				xmlString: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				options: { depth: 2 },
				expectedTagNames: ['AAA_1', 'AA_1'],
			},
			'stops at specified tag name (inclusive)': {
				xmlString: xml,
				ref: { tagName: 'AAAA_1', id: 'aaaa1' },
				options: { stopAtTagName: 'A' },
				expectedTagNames: ['AAA_1', 'AA_1', 'A'],
			},
			'returns empty array when ref does not exist': {
				xmlString: /* xml */ `<Root ${ns} />`,
				ref: { tagName: 'AAAA_1', id: 'non-existent' },
				expectedTagNames: [],
			},
			'depth=1 returns only direct parent': {
				xmlString: xml,
				ref: { tagName: 'AAA_1', id: 'aaa1' },
				options: { depth: 1 },
				expectedTagNames: ['AA_1'],
			},
		}

		it.each(Object.entries(testCases))('%s', async (_, tc) => {
			const { document, cleanup } = await createTestDialecte({ xmlString: tc.xmlString })

			try {
				const ancestors = await document.query.findAncestors(tc.ref, tc.options)

				expect(ancestors.map((a) => a.tagName)).toEqual(tc.expectedTagNames)
			} finally {
				await cleanup()
			}
		})
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
