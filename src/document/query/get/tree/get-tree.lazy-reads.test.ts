import lazyXml from './fixtures/wrapped-children.xml?raw'
import { toShape } from './get-tree.fixtures'
import { TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { createTestRunner } from '@/test'

import type {
	LazyReadsCase,
	StoreCounts,
	TransparentTestDialecteConfig,
	TreeShape,
} from './get-tree.fixtures.types'
import type { ActParams, TestCases } from '@/test'
import type { AnyTreeRecord } from '@/types'

const none: StoreCounts = { get: 0, getMany: 0, getByTagName: 0, getByDocumentId: 0 }
const a1 = { tagName: 'A', id: 'a1' } as const

function leaf(tagName: string): TreeShape {
	return { tagName, tree: [] }
}

/** The store calls and records moved by one lazy read, inside a transaction holding the staged writes when given. */
async function readsOneLevelPerOpenLevel({
	source,
	testCase,
}: ActParams<TransparentTestDialecteConfig, LazyReadsCase>): Promise<void> {
	const { ref, options, stage } = testCase
	const tree = stage
		? await source.transaction(async function readStaged(tx) {
				await stage(tx)
				source.perf.reset()
				return tx.getTree(ref, options)
			})
		: await readCommitted()
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

	async function readCommitted(): Promise<AnyTreeRecord | undefined> {
		source.perf.reset()
		return source.query.getTree(ref, options)
	}
}

describe('getTree - a lazy read moves one level per open level, never the whole document', () => {
	const root = { tagName: 'Root', id: 'root' } as const
	const testCases: TestCases<LazyReadsCase> = {
		'the document root + depth 1 → the root by get, one getRecords, no whole-document read': {
			sourceXml: lazyXml,
			ref: root,
			options: { depth: 1 },
			expected: {
				shape: { tagName: 'Root', tree: [leaf('A'), leaf('A'), leaf('B')] },
				calls: { ...none, get: 1, getMany: 1 },
				recordsMoved: { ...none, get: 1, getMany: 3 },
			},
		},
		'depth 1 through a transparent wrapper → one more getRecords for the hoisted level': {
			sourceXml: lazyXml,
			ref: a1,
			options: { depth: 1 },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2')] },
				calls: { ...none, get: 1, getMany: 2 },
				recordsMoved: { ...none, get: 1, getMany: 4 },
			},
		},
		'an expanded frontier on two levels → one getRecords per open level, the opened nodes children moved':
			{
				sourceXml: lazyXml,
				ref: root,
				options: { expanded: new Set(['root', 'a1', 'aa2']) },
				expected: {
					shape: {
						tagName: 'Root',
						tree: [
							{
								tagName: 'A',
								tree: [{ tagName: 'AA_2', tree: [leaf('AAA_3')] }, leaf('AAA_1'), leaf('AAA_2')],
							},
							leaf('A'),
							leaf('B'),
						],
					},
					calls: { ...none, get: 1, getMany: 3 },
					recordsMoved: { ...none, get: 1, getMany: 8 },
				},
			},
		'expanded on the document root without id → the root by its tag, no whole-document read': {
			sourceXml: lazyXml,
			ref: { tagName: 'Root' },
			options: { expanded: new Set(['root']) },
			expected: {
				shape: { tagName: 'Root', tree: [leaf('A'), leaf('A'), leaf('B')] },
				calls: { ...none, getByTagName: 1, getMany: 1 },
				recordsMoved: { ...none, getByTagName: 1, getMany: 3 },
			},
		},
		'a listed id under a closed parent → never read': {
			sourceXml: lazyXml,
			ref: a1,
			options: { expanded: new Set(['a1', 'aaa3', 'aaaa1']) },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2')] },
				calls: { ...none, get: 1, getMany: 2 },
				recordsMoved: { ...none, get: 1, getMany: 4 },
			},
		},
		'an id listed that names no record → ignored, the same reads as without it': {
			sourceXml: lazyXml,
			ref: a1,
			options: { expanded: new Set(['a1', 'not-in-the-document']) },
			expected: {
				shape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2')] },
				calls: { ...none, get: 1, getMany: 2 },
				recordsMoved: { ...none, get: 1, getMany: 4 },
			},
		},
		'an empty set → the root alone, its own read only': {
			sourceXml: lazyXml,
			ref: a1,
			options: { expanded: new Set() },
			expected: {
				shape: leaf('A'),
				calls: { ...none, get: 1 },
				recordsMoved: { ...none, get: 1 },
			},
		},
		'expanded with a staged child in an open hoisted level → the staged child in the tree, never read from the store, no whole-document read':
			{
				sourceXml: lazyXml,
				ref: root,
				options: { expanded: new Set(['root', 'a1']) },
				stage: async function stageCreateInTheWrapper(tx) {
					await tx.addChild(
						{ tagName: 'AA_1', id: 'aa1' },
						{ tagName: 'AAA_3', attributes: { 'ext:aAAA_3': 'v' } },
					)
				},
				expected: {
					shape: {
						tagName: 'Root',
						tree: [
							{
								tagName: 'A',
								tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2'), leaf('AAA_3')],
							},
							leaf('A'),
							leaf('B'),
						],
					},
					calls: { ...none, get: 1, getMany: 3 },
					recordsMoved: { ...none, get: 1, getMany: 6 },
				},
			},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act: readsOneLevelPerOpenLevel, dev: { perf: true } })
})
