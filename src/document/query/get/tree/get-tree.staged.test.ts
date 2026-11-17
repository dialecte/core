import { toShape } from './get-tree.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { TreeShape } from './get-tree.fixtures.types'
import type { GetTreeParams, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="v" />
		</A>
		<A ${customId}="a2" aA="v">
			<AA_2 ${customId}="aa3" aAA_2="v" />
		</A>
	</Root>
`

const a1 = { tagName: 'A', id: 'a1' } as const

function leaf(tagName: string): TreeShape {
	return { tagName, tree: [] }
}

describe('getTree - inside a transaction, read level by level with the staged records', () => {
	type TestCase = BaseXmlTestCase & {
		stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
		options: GetTreeParams<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		expected: { shape: TreeShape; wholeDocumentReads: number }
	}

	const testCases: TestCases<TestCase> = {
		'a staged child created under a select → kept, no whole-document read': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-1', attributes: { aAA_2: 'v' } })
			},
			options: { select: { AA_2: true } },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AA_2')] },
				wholeDocumentReads: 0,
			},
		},
		'a staged deleted child under a select → left out, no whole-document read': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_2', id: 'aa2' })
			},
			options: { select: { AA_1: true, AA_2: true } },
			expected: {
				shape: { tagName: 'A', tree: [{ tagName: 'AA_1', tree: [leaf('AAA_1')] }] },
				wholeDocumentReads: 0,
			},
		},
		'a staged update failing the where of a select → dropped with its subtree, no whole-document read':
			{
				sourceXml: xml,
				stage: async (tx) => {
					await tx.update({ tagName: 'AA_1', id: 'aa1' }, { attributes: { aAA_1: 'new' } })
				},
				options: { select: { AA_1: { where: { aAA_1: 'v' }, AAA_1: true } } },
				expected: { shape: { tagName: 'A', tree: [] }, wholeDocumentReads: 0 },
			},
		'a depth with staged writes → the staged level, no whole-document read': {
			sourceXml: xml,
			stage: async (tx) => {
				await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-1', attributes: { aAA_2: 'v' } })
			},
			options: { depth: 1 },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_1'), leaf('AA_2'), leaf('AA_2')] },
				wholeDocumentReads: 0,
			},
		},
		'a tag-only omit with staged writes → the staged tree without the tag, no whole-document read':
			{
				sourceXml: xml,
				stage: async (tx) => {
					await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-1', attributes: { aAA_2: 'v' } })
				},
				options: { omit: ['AA_1'] },
				expected: {
					shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AA_2')] },
					wholeDocumentReads: 0,
				},
			},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const tree = await source.transaction(async function readStaged(tx) {
			await testCase.stage(tx)
			source.perf.reset()
			return tx.getTree(a1, testCase.options)
		})
		const report = source.perf.report()
		expect({
			shape: toShape(tree as AnyTreeRecord),
			wholeDocumentReads: report['core::store::getByDocumentId']?.count ?? 0,
		}).toEqual(testCase.expected)
	}

	runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
})
