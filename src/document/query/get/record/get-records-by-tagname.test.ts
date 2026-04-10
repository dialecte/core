import { getRecordsByTagName } from './get-records-by-tagname'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestContext,
	createTestDialecte,
	runTestCases,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecordsByTagName', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			tagName: 'A' | 'B' | 'AA_1'
			expectedCount: number
			expectedIds?: string[]
		}

		const testCases: TestCases<TestCase> = {
			'returns empty array when no records match tagName': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				tagName: 'A',
				expectedCount: 0,
			},
			'returns single record matching tagName': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				tagName: 'A',
				expectedCount: 1,
				expectedIds: ['a1'],
			},
			'returns all records of a tagName when multiple exist': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="first" />
						<A ${customId}="a2" aA="second" />
						<A ${customId}="a3" aA="third" />
					</Root>
				`,
				tagName: 'A',
				expectedCount: 3,
				expectedIds: ['a1', 'a2', 'a3'],
			},
			'only returns records of the requested tagName': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
						<B ${customId}="b1" aB="v" />
					</Root>
				`,
				tagName: 'A',
				expectedCount: 1,
				expectedIds: ['a1'],
			},
			'returns records with status unchanged': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				tagName: 'A',
				expectedCount: 1,
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const records = await source.document.query.getRecordsByTagName(testCase.tagName)

			expect(records).toHaveLength(testCase.expectedCount)

			if (testCase.expectedIds) {
				const ids = records.map((r) => r.id)
				for (const id of testCase.expectedIds) {
					expect(ids).toContain(id)
				}
			}

			for (const record of records) {
				expect(record.status).toBe('unchanged')
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('includes staged created record in results', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="p" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const records = await tx.getRecordsByTagName('AA_1')

					expect(records).toHaveLength(1)
					expect(records[0].id).toBe('0-0-0-0-1')
					expect(records[0].status).toBe('created')
				})
			} finally {
				await cleanup()
			}
		})

		it('excludes staged deleted record from results', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="p">
						<AA_1 ${customId}="aa1" aAA_1="v" />
						<AA_1 ${customId}="aa2" aAA_1="v2" />
					</A>
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const records = await tx.getRecordsByTagName('AA_1')

					expect(records).toHaveLength(1)
					expect(records[0].id).toBe('aa2')
				})
			} finally {
				await cleanup()
			}
		})

		it('reflects staged updated attributes in results', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="old" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })

					const records = await tx.getRecordsByTagName('A')

					expect(records).toHaveLength(1)
					expect(records[0].status).toBe('updated')
				})
			} finally {
				await cleanup()
			}
		})
	})

	describe('record cache', () => {
		it('populates cache for all records fetched from store', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v1" />
					<A ${customId}="a2" aA="v2" />
				</Root>
			`
			const { databaseName, cleanup } = await createTestDialecte({ xmlString })

			try {
				const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })

				expect(context.recordCache!.has('a1')).toBe(false)
				expect(context.recordCache!.has('a2')).toBe(false)

				await getRecordsByTagName({ context, tagName: 'A' })

				expect(context.recordCache!.has('a1')).toBe(true)
				expect(context.recordCache!.has('a2')).toBe(true)
			} finally {
				await cleanup()
			}
		})
	})
})
