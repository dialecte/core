import { getRecord } from './get-record'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	createTestContext,
	createTestDialecte,
} from '@/test-fixtures'

import type { TestDialecteConfig } from '@/test-fixtures'
import type { ElementsOf, Ref } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecord', () => {
	describe('store reads', () => {
		type TestCase = {
			description: string
			xmlString: string
			ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
			expectedTagName?: string
			expectedId?: string
			expectedStatus?: 'unchanged'
			expectUndefined?: true
		}

		const testCases: TestCase[] = [
			{
				description: 'returns record by id with status unchanged',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="val" />
					</Root>
				`,
				ref: { tagName: 'A', id: 'a1' },
				expectedTagName: 'A',
				expectedId: 'a1',
				expectedStatus: 'unchanged',
			},
			{
				description: 'returns undefined when id does not exist',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="val" />
					</Root>
				`,
				ref: { tagName: 'A', id: 'non-existent' },
				expectUndefined: true,
			},
			{
				description: 'returns singleton by tagName when id is omitted',
				xmlString: /* xml */ `<Root ${ns} />`,
				ref: { tagName: 'Root' } as Ref<TestDialecteConfig, 'Root'>,
				expectedTagName: 'Root',
				expectedStatus: 'unchanged',
			},
			{
				description: 'returns deeply nested record by id',
				xmlString: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="l0">
							<AA_1 ${customId}="aa1" aAA_1="l1">
								<AAA_1 ${customId}="aaa1" aAAA_1="l2" />
							</AA_1>
						</A>
					</Root>
				`,
				ref: { tagName: 'AAA_1', id: 'aaa1' },
				expectedTagName: 'AAA_1',
				expectedId: 'aaa1',
				expectedStatus: 'unchanged',
			},
		]

		it.each(testCases)(
			'$description',
			async ({ xmlString, ref, expectedTagName, expectedId, expectedStatus, expectUndefined }) => {
				const { document, cleanup } = await createTestDialecte({ xmlString })

				try {
					const record = await document.query.getRecord(ref)

					if (expectUndefined) {
						expect(record).toBeUndefined()
					} else {
						expect(record).toBeDefined()
						if (expectedTagName !== undefined) {
							expect(record?.tagName).toBe(expectedTagName)
						}
						if (expectedId !== undefined) {
							expect(record?.id).toBe(expectedId)
						}
						if (expectedStatus !== undefined) {
							expect(record?.status).toBe(expectedStatus)
						}
					}
				} finally {
					await cleanup()
				}
			},
		)
	})

	describe('staged operation visibility', () => {
		it('returns staged created record within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="p" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const record = await tx.getRecord({ tagName: 'AA_1', id: '0-0-0-0-1' })

					expect(record).toBeDefined()
					expect(record?.tagName).toBe('AA_1')
					expect(record?.status).toBe('created')
				})
			} finally {
				await cleanup()
			}
		})

		it('returns undefined for staged deleted record within transaction', async () => {
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

					const record = await tx.getRecord({ tagName: 'AA_1', id: 'aa1' })

					expect(record).toBeUndefined()
				})
			} finally {
				await cleanup()
			}
		})

		it('returns staged updated attributes within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="old" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })

					const record = await tx.getRecord({ tagName: 'A', id: 'a1' })

					expect(record?.status).toBe('updated')
				})
			} finally {
				await cleanup()
			}
		})
	})

	describe('record cache', () => {
		it('populates cache on store hit by id', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { databaseName, cleanup } = await createTestDialecte({ xmlString })

			try {
				const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })

				expect(context.recordCache!.has('a1')).toBe(false)

				await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				expect(context.recordCache!.has('a1')).toBe(true)
				expect(context.recordCache!.get('a1')).toMatchObject({ id: 'a1', tagName: 'A' })
			} finally {
				await cleanup()
			}
		})

		it('returns cache entry on second call by id', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { databaseName, cleanup } = await createTestDialecte({ xmlString })

			try {
				const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })

				await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				const cachedRaw = context.recordCache!.get('a1')

				const second = await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				// The raw in the cache is the same object used for the second result
				expect(second).toMatchObject(cachedRaw!)
			} finally {
				await cleanup()
			}
		})

		it('populates both id and singleton cache keys for tagName lookup', async () => {
			const xmlString = /* xml */ `<Root ${ns} />`
			const { databaseName, cleanup } = await createTestDialecte({ xmlString })

			try {
				const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })

				const root = await getRecord({
					context,
					ref: { tagName: 'Root' } as Ref<TestDialecteConfig, 'Root'>,
				})

				const rootId = root!.id

				expect(context.recordCache!.has(rootId)).toBe(true)
				expect(context.recordCache!.has('__singleton_Root')).toBe(true)
				expect(context.recordCache!.get(rootId)).toBe(context.recordCache!.get('__singleton_Root'))
			} finally {
				await cleanup()
			}
		})

		it('does not populate cache outside of transaction context', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { databaseName, cleanup } = await createTestDialecte({ xmlString })

			try {
				// A query context has recordCache: undefined
				const context = {
					...createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG }),
					recordCache: undefined,
				}

				const record = await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				expect(record).toBeDefined()
				expect(record?.id).toBe('a1')
			} finally {
				await cleanup()
			}
		})
	})
})
