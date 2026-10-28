import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

type TestDocument = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']

const assembly = { tagName: 'A' as const, id: 'a' }

/** Settles a write: its error, or nothing when it went through. */
async function settle(write: () => Promise<unknown>): Promise<unknown> {
	try {
		await write()
		return undefined
	} catch (thrown) {
		return thrown
	}
}

describe('Document - one transaction at a time, prepare and its commit included', () => {
	type TestCase = BaseXmlTestCase & {
		/** Answers the error the overlapping write raised. */
		overlap: (document: TestDocument) => Promise<unknown>
	}

	const testCases: TestCases<TestCase> = {
		'prepare inside a transaction → CONCURRENT_TRANSACTION': {
			sourceXml: /* xml */ `<Root ${ns}><A aA="A" dev:db-id="a"><AA_1 aAA_1="one"/></A></Root>`,
			overlap: async (document) => {
				let inner: unknown
				await document.transaction(async (tx) => {
					await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
					inner = await settle(() =>
						document.prepare(async (innerTx) => {
							await innerTx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '6' } })
						}),
					)
				})
				return inner
			},
		},
		'transaction inside a prepare callback → CONCURRENT_TRANSACTION': {
			sourceXml: /* xml */ `<Root ${ns}><A aA="A" dev:db-id="a"><AA_1 aAA_1="one"/></A></Root>`,
			overlap: async (document) => {
				let inner: unknown
				const prepared = await document.prepare(async (tx) => {
					await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
					inner = await settle(() =>
						document.transaction(async (innerTx) => {
							await innerTx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '6' } })
						}),
					)
				})
				prepared.discard()
				return inner
			},
		},
		'two prepares at once (Promise.all) → the second CONCURRENT_TRANSACTION': {
			sourceXml: /* xml */ `<Root ${ns}><A aA="A" dev:db-id="a"><AA_1 aAA_1="one"/></A></Root>`,
			overlap: async (document) => {
				const [first, second] = await Promise.allSettled([
					document.prepare(async (tx) => {
						await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
					}),
					document.prepare(async (tx) => {
						await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '6' } })
					}),
				])
				if (first.status === 'fulfilled') first.value.discard()
				return second.status === 'rejected' ? second.reason : undefined
			},
		},
		'a prepared commit while a transaction is open → CONCURRENT_TRANSACTION, nothing of it written':
			{
				sourceXml: /* xml */ `<Root ${ns}><A aA="A" dev:db-id="a"><AA_1 aAA_1="one"/></A></Root>`,
				overlap: async (document) => {
					const prepared = await document.prepare(async (tx) => {
						await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
					})
					let inner: unknown
					await document.transaction(async (tx) => {
						await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '6' } })
						inner = await settle(() => prepared.commit())
					})
					const written = await document.query.getRecordsByTagName('AA_2')
					expect(written).toHaveLength(1)
					return inner
				},
			},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ testCase, source }) => {
			const thrown = await testCase.overlap(source)
			expect(toDialecteError(thrown)?.key).toBe('CONCURRENT_TRANSACTION')
		},
	})
})
