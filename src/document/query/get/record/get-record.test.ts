import { getRecord } from './get-record'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	createTestContext,
	createTestProject,
	runTestCases,
} from '@/test'

import type { Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecord', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
			expectedTagName?: string
			expectedId?: string
			expectedStatus?: 'unchanged'
			expectUndefined?: true
		}

		const testCases: TestCases<TestCase> = {
			'returns record by id with status unchanged': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="val" />
					</Root>
				`,
				ref: { tagName: 'A', id: 'a1' },
				expectedTagName: 'A',
				expectedId: 'a1',
				expectedStatus: 'unchanged',
			},
			'returns undefined when id does not exist': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="val" />
					</Root>
				`,
				ref: { tagName: 'A', id: 'non-existent' },
				expectUndefined: true,
			},
			'returns singleton by tagName when id is omitted': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				ref: { tagName: 'Root' } as Ref<TestDialecteConfig, 'Root'>,
				expectedTagName: 'Root',
				expectedStatus: 'unchanged',
			},
			'returns deeply nested record by id': {
				sourceXml: /* xml */ `
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
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const record = await source.query.getRecord(testCase.ref)

			if (testCase.expectUndefined) {
				expect(record).toBeUndefined()
			} else {
				expect(record).toBeDefined()
				if (testCase.expectedTagName !== undefined) {
					expect(record?.tagName).toBe(testCase.expectedTagName)
				}
				if (testCase.expectedId !== undefined) {
					expect(record?.id).toBe(testCase.expectedId)
				}
				if (testCase.expectedStatus !== undefined) {
					expect(record?.status).toBe(testCase.expectedStatus)
				}
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('returns staged created record within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="p" /></Root>`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

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
				await project.destroy()
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
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const record = await tx.getRecord({ tagName: 'AA_1', id: 'aa1' })

					expect(record).toBeUndefined()
				})
			} finally {
				await project.destroy()
			}
		})

		it('returns staged updated attributes within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="old" /></Root>`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'new' } })

					const record = await tx.getRecord({ tagName: 'A', id: 'a1' })

					expect(record?.status).toBe('updated')
				})
			} finally {
				await project.destroy()
			}
		})
	})

	describe('record cache', () => {
		it('populates cache on store hit by id', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { project, source } = await createTestProject({ sourceXml: xmlString })

			try {
				const context = await createTestContext({
					databaseName: project.name,
					dialecteConfig: TEST_DIALECTE_CONFIG,
					documentId: source.documentId,
				})

				expect(context.recordCache!.has('a1')).toBe(false)

				await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				expect(context.recordCache!.has('a1')).toBe(true)
				expect(context.recordCache!.get('a1')).toMatchObject({ id: 'a1', tagName: 'A' })
			} finally {
				await project.destroy()
			}
		})

		it('returns cache entry on second call by id', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { project, source } = await createTestProject({ sourceXml: xmlString })

			try {
				const context = await createTestContext({
					databaseName: project.name,
					dialecteConfig: TEST_DIALECTE_CONFIG,
					documentId: source.documentId,
				})

				await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				const cachedRaw = context.recordCache!.get('a1')

				const second = await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				// The raw in the cache is the same object used for the second result
				expect(second).toMatchObject(cachedRaw!)
			} finally {
				await project.destroy()
			}
		})

		it('populates both id and singleton cache keys for tagName lookup', async () => {
			const xmlString = /* xml */ `<Root ${ns} />`
			const { project, source } = await createTestProject({ sourceXml: xmlString })

			try {
				const context = await createTestContext({
					databaseName: project.name,
					dialecteConfig: TEST_DIALECTE_CONFIG,
					documentId: source.documentId,
				})

				const root = await getRecord({
					context,
					ref: { tagName: 'Root' } as Ref<TestDialecteConfig, 'Root'>,
				})

				const rootId = root!.id

				expect(context.recordCache!.has(rootId)).toBe(true)
				expect(context.recordCache!.has('__singleton_Root')).toBe(true)
				expect(context.recordCache!.get(rootId)).toBe(context.recordCache!.get('__singleton_Root'))
			} finally {
				await project.destroy()
			}
		})

		it('does not populate cache outside of transaction context', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { project, source } = await createTestProject({ sourceXml: xmlString })

			try {
				// A query context has recordCache: undefined
				const context = {
					...(await createTestContext({
						databaseName: project.name,
						dialecteConfig: TEST_DIALECTE_CONFIG,
						documentId: source.documentId,
					})),
					recordCache: undefined,
				}

				const record = await getRecord({ context, ref: { tagName: 'A', id: 'a1' } })

				expect(record).toBeDefined()
				expect(record?.id).toBe('a1')
			} finally {
				await project.destroy()
			}
		})
	})
})
