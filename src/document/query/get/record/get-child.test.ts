import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getChild', () => {
	describe('store reads', () => {
		type TestCase = {
			xmlString: string
			parentRef: { tagName: 'A'; id: string }
			childTagName: 'AA_1' | 'AA_2' | 'AA_3'
			expectedId?: string
			expectUndefined?: true
		}

		const testCases: Record<string, TestCase> = {
			'returns matching child record': {
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="c" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedId: 'aa1',
			},
			'returns first child when multiple exist': {
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="first" />
							<AA_1 ${customId}="aa2" aAA_1="second" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedId: 'aa1',
			},
			'returns undefined when parent has no matching child tag': {
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="c" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_2',
				expectUndefined: true,
			},
			'returns undefined when parent does not exist': {
				xmlString: /* xml */ `<Root ${ns} />`,
				parentRef: { tagName: 'A', id: 'non-existent' },
				childTagName: 'AA_1',
				expectUndefined: true,
			},
			'returns undefined when parent has no children': {
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectUndefined: true,
			},
		}

		it.each(Object.entries(testCases))('%s', async (_, tc) => {
			const { document, cleanup } = await createTestDialecte({ xmlString: tc.xmlString })

			try {
				const child = await document.query.getChild(tc.parentRef, tc.childTagName)

				if (tc.expectUndefined) {
					expect(child).toBeUndefined()
				} else {
					expect(child).toBeDefined()
					if (tc.expectedId !== undefined) expect(child?.id).toBe(tc.expectedId)
					expect(child?.tagName).toBe(tc.childTagName)
					expect(child?.status).toBe('unchanged')
				}
			} finally {
				await cleanup()
			}
		})
	})

	describe('staged operation visibility', () => {
		it('returns staged created child within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const child = await tx.getChild({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(child).toBeDefined()
					expect(child?.id).toBe('0-0-0-0-1')
					expect(child?.status).toBe('created')
				})
			} finally {
				await cleanup()
			}
		})

		it('returns undefined for staged deleted child', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="c" />
					</A>
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const child = await tx.getChild({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(child).toBeUndefined()
				})
			} finally {
				await cleanup()
			}
		})
	})
})
