import { toShape } from './get-tree.fixtures'
import { TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
	runTestCases,
} from '@/test'

import type { TransparentTestDialecteConfig, TreeShape } from './get-tree.fixtures.types'
import type { GetTreeParams, Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, AnyTreeRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

// 11 records: Root, a1 (aa1 > aaa1 aaa2, aa2, aa3), a2 > aa4 > aaa3, b1
const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v" />
				<AAA_2 ${customId}="aaa2" aAAA_2="v" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="v" />
			<AA_3 ${customId}="aa3" aAA_3="v" />
		</A>
		<A ${customId}="a2" aA="v">
			<AA_1 ${customId}="aa4" aAA_1="v">
				<AAA_1 ${customId}="aaa3" aAAA_1="v" />
			</AA_1>
		</A>
		<B ${customId}="b1" aB="v" />
	</Root>
`

type RecordsMoved = { get: number; getMany: number; getByTagName: number; getByDocumentId: number }

type ReadsCase<GenericConfig extends AnyDialecteConfig> = BaseXmlTestCase & {
	ref: Ref<GenericConfig, ElementsOf<GenericConfig>>
	options: GetTreeParams<GenericConfig, ElementsOf<GenericConfig>>
	expected: { shape: TreeShape; recordsMoved: RecordsMoved }
}

const a1 = { tagName: 'A', id: 'a1' } as const
const none: RecordsMoved = { get: 0, getMany: 0, getByTagName: 0, getByDocumentId: 0 }

function leaf(tagName: string): TreeShape {
	return { tagName, tree: [] }
}

async function readsOnlyTheKeptBranches<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, ReadsCase<GenericConfig>>): Promise<void> {
	source.perf.reset()
	const tree = await source.query.getTree(testCase.ref, testCase.options)
	const report = source.perf.report()
	expect({
		shape: toShape(tree as AnyTreeRecord),
		recordsMoved: {
			get: report['core::store::records.get']?.count ?? 0,
			getMany: report['core::store::records.getMany']?.count ?? 0,
			getByTagName: report['core::store::records.getByTagName']?.count ?? 0,
			getByDocumentId: report['core::store::records.getByDocumentId']?.count ?? 0,
		},
	}).toEqual(testCase.expected)
}

describe('getTree - reads only the branches it keeps', () => {
	const testCases: TestCases<ReadsCase<TestDialecteConfig>> = {
		'a nested select → the root by get, one level each of the kept children': {
			sourceXml: xml,
			ref: a1,
			options: { select: { AA_1: { AAA_1: true } } },
			expected: {
				shape: { tagName: 'A', tree: [{ tagName: 'AA_1', tree: [leaf('AAA_1')] }] },
				recordsMoved: { ...none, get: 1, getMany: 2 },
			},
		},
		'a select true → the whole selected subtree, its siblings never read': {
			sourceXml: xml,
			ref: a1,
			options: { select: { AA_1: true } },
			expected: {
				shape: { tagName: 'A', tree: [{ tagName: 'AA_1', tree: [leaf('AAA_1'), leaf('AAA_2')] }] },
				recordsMoved: { ...none, get: 1, getMany: 3 },
			},
		},
		'a select where failing → the child read, its subtree never read': {
			sourceXml: xml,
			ref: a1,
			options: { select: { AA_1: { where: { aAA_1: 'other' }, AAA_1: true } } },
			expected: {
				shape: { tagName: 'A', tree: [] },
				recordsMoved: { ...none, get: 1, getMany: 1 },
			},
		},
		'a tag-only omit → the omitted children and their subtrees never read': {
			sourceXml: xml,
			ref: a1,
			options: { omit: ['AA_1'] },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AA_3')] },
				recordsMoved: { ...none, get: 1, getMany: 2 },
			},
		},
		'a singleton ref with a select → the root by its tag, then the kept children': {
			sourceXml: xml,
			ref: { tagName: 'Root' },
			options: { select: { B: true } },
			expected: {
				shape: { tagName: 'Root', tree: [leaf('B')] },
				recordsMoved: { ...none, getByTagName: 1, getMany: 1 },
			},
		},
		'an omit with where only on a subtree root → read by levels, the omitted child read, its subtree never read':
			{
				sourceXml: xml,
				ref: a1,
				options: { omit: [{ AA_1: { where: { aAA_1: 'v' } } }] },
				expected: {
					shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AA_3')] },
					recordsMoved: { ...none, get: 1, getMany: 3 },
				},
			},
	}

	runTestCases.withoutExport({ testCases, act: readsOnlyTheKeptBranches, dev: { perf: true } })
})

describe('getTree - reads through transparent elements under a select', () => {
	const testCases: TestCases<ReadsCase<TransparentTestDialecteConfig>> = {
		'a select of what a transparent element holds → the wrapper read, its unselected siblings and children never read':
			{
				sourceXml: xml,
				ref: a1,
				options: { select: { AAA_1: true } as never },
				expected: {
					shape: { tagName: 'A', tree: [leaf('AAA_1')] },
					recordsMoved: { ...none, get: 1, getMany: 2 },
				},
			},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({
		testCases,
		act: readsOnlyTheKeptBranches,
		dev: { perf: true },
	})
})

type ReadCalls = RecordsMoved

type NoOptionsCase<GenericConfig extends AnyDialecteConfig> = BaseXmlTestCase & {
	ref: Ref<GenericConfig, ElementsOf<GenericConfig>>
	expected: { shape: TreeShape; calls: ReadCalls; recordsMoved: RecordsMoved }
}

async function readsByLevelsBelowTheDocumentRoot<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, NoOptionsCase<GenericConfig>>): Promise<void> {
	source.perf.reset()
	const tree = await source.query.getTree(testCase.ref)
	const report = source.perf.report()
	expect({
		shape: toShape(tree as AnyTreeRecord),
		calls: {
			get: report['core::store::get']?.count ?? 0,
			getMany: report['core::store::getMany']?.count ?? 0,
			getByTagName: report['core::store::getByTagName']?.count ?? 0,
			getByDocumentId: report['core::store::getByDocumentId']?.count ?? 0,
		},
		recordsMoved: {
			get: report['core::store::records.get']?.count ?? 0,
			getMany: report['core::store::records.getMany']?.count ?? 0,
			getByTagName: report['core::store::records.getByTagName']?.count ?? 0,
			getByDocumentId: report['core::store::records.getByDocumentId']?.count ?? 0,
		},
	}).toEqual(testCase.expected)
}

describe('getTree - no options: a root below the document root reads by levels', () => {
	const testCases: TestCases<NoOptionsCase<TestDialecteConfig>> = {
		'a subtree root by id → the root by get, one getRecords per level, only its subtree moved': {
			sourceXml: xml,
			ref: a1,
			expected: {
				shape: {
					tagName: 'A',
					tree: [
						{ tagName: 'AA_1', tree: [leaf('AAA_1'), leaf('AAA_2')] },
						leaf('AA_2'),
						leaf('AA_3'),
					],
				},
				calls: { ...none, get: 1, getMany: 2 },
				recordsMoved: { ...none, get: 1, getMany: 5 },
			},
		},
		'a leaf root by id → the root by get, no level read': {
			sourceXml: xml,
			ref: { tagName: 'B', id: 'b1' },
			expected: {
				shape: leaf('B'),
				calls: { ...none, get: 1 },
				recordsMoved: { ...none, get: 1 },
			},
		},
		'the document root → one whole-document read': {
			sourceXml: xml,
			ref: { tagName: 'Root' },
			expected: {
				shape: {
					tagName: 'Root',
					tree: [
						{
							tagName: 'A',
							tree: [
								{ tagName: 'AA_1', tree: [leaf('AAA_1'), leaf('AAA_2')] },
								leaf('AA_2'),
								leaf('AA_3'),
							],
						},
						{ tagName: 'A', tree: [{ tagName: 'AA_1', tree: [leaf('AAA_1')] }] },
						leaf('B'),
					],
				},
				calls: { ...none, getByDocumentId: 1 },
				recordsMoved: { ...none, getByDocumentId: 11 },
			},
		},
		'a ref without id below the document root → one whole-document read, the first of its tag': {
			sourceXml: xml,
			ref: { tagName: 'A' },
			expected: {
				shape: {
					tagName: 'A',
					tree: [
						{ tagName: 'AA_1', tree: [leaf('AAA_1'), leaf('AAA_2')] },
						leaf('AA_2'),
						leaf('AA_3'),
					],
				},
				calls: { ...none, getByDocumentId: 1 },
				recordsMoved: { ...none, getByDocumentId: 11 },
			},
		},
	}

	runTestCases.withoutExport({
		testCases,
		act: readsByLevelsBelowTheDocumentRoot,
		dev: { perf: true },
	})
})
