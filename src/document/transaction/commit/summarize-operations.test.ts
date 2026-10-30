import { summarizeOperations } from './summarize-operations'

import { describe, expect } from 'vitest'

import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
	type TEST_DIALECTE_CONFIG,
} from '@/test'

import type { OperationsSummary } from './summarize-operations.types'
import type { ActParams, BaseXmlTestCase, TestCases } from '@/test'

type TestTransaction = Parameters<
	Parameters<ActParams<typeof TEST_DIALECTE_CONFIG, BaseXmlTestCase>['source']['prepare']>[0]
>[0]

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

describe('summarizeOperations and prepared.summary', () => {
	type TestCase = BaseXmlTestCase & {
		write: (tx: TestTransaction) => Promise<void>
		expected: OperationsSummary
	}

	const testCases: TestCases<TestCase> = {
		'2 AA_2 and an AAA_1 added, one AA_2 updated → one count per record, as the commit merges them':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="A" dev:db-id="a"><AA_1 aAA_1="one"><AAA_1 aAAA_1="abc"/></AA_1></A>
				</Root>
			`,
				write: async (tx) => {
					const assembly = { tagName: 'A' as const, id: 'a' }
					const first = await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '5' } })
					await tx.addChild(assembly, { tagName: 'AA_2', attributes: { aAA_2: '6' } })
					await tx.addChild(first, { tagName: 'AAA_1', attributes: { aAAA_1: 'def' } })
					await tx.update(first, { attributes: { bAA_2: 'changed' } })
				},
				expected: {
					creates: 3,
					updates: 1,
					deletes: 0,
					byTag: {
						A: { created: 0, updated: 1, deleted: 0 },
						AA_2: { created: 2, updated: 0, deleted: 0 },
						AAA_1: { created: 1, updated: 0, deleted: 0 },
					},
				},
			},
		'an AA_2 created then deleted, an AAA_1 deleted → the AA_2 not counted, one deletion': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A aA="A" dev:db-id="a"><AA_1 aAA_1="one" dev:db-id="aa1"><AAA_1 aAAA_1="abc" dev:db-id="aaa1"/></AA_1></A>
				</Root>
			`,
			write: async (tx) => {
				const added = await tx.addChild(
					{ tagName: 'A', id: 'a' },
					{ tagName: 'AA_2', attributes: { aAA_2: '5' } },
				)
				await tx.delete(added)
				await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
			},
			expected: {
				creates: 0,
				updates: 2,
				deletes: 1,
				byTag: {
					A: { created: 0, updated: 1, deleted: 0 },
					AA_1: { created: 0, updated: 1, deleted: 0 },
					AAA_1: { created: 0, updated: 0, deleted: 1 },
				},
			},
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ testCase, source }) => {
			const prepared = await source.prepare(testCase.write)
			expect(summarizeOperations(prepared.operations)).toEqual(testCase.expected)
			expect(prepared.summary).toEqual(testCase.expected)
			prepared.discard()
		},
	})
})
