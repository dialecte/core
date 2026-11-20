import LAZY_TRANSPARENT_XML from './fixtures/wrapped-children.xml?raw'
import { GET_TREE_CASES, toShape } from './get-tree.fixtures'
import { cutTree, idsOf } from './get-tree.lazy.fixtures'
import { AUTO_RECURSION_CASES, RECURSIVE_CONFIG } from './get-tree.recursion.fixtures'
import { TRANSPARENT_CASES, TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { createTestRunner, runTestCases } from '@/test'

import type {
	GetTreeCase,
	LazyTreeCase,
	RecursiveTestDialecteConfig,
	TransparentTestDialecteConfig,
} from './get-tree.fixtures.types'
import type { ActParams, TestCases } from '@/test'
import type { AnyDialecteConfig, AnyTreeRecord } from '@/types'

/**
 * Lazy oracle runner: a `depth` or `expanded` read answers, field by field, the full tree read with the same other
 * options and cut at the boundary (`cutTree`), committed and with the case's staged writes pending; its shape is the
 * one expected with the writes staged.
 */
async function readsTheFullTreeCutAtTheBoundary<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, LazyTreeCase<GenericConfig>>): Promise<void> {
	const { ref, options = {}, stage } = testCase
	const { depth, expanded, ...fullOptions } = options as {
		depth?: number
		expanded?: ReadonlySet<string>
	}
	const committedFull: AnyTreeRecord | undefined = await source.query.getTree(ref, fullOptions)
	const committedLazy: AnyTreeRecord | undefined = await source.query.getTree(ref, options)
	const staged = await source.transaction(async function readBothWays(tx) {
		await stage?.(tx)
		const full: AnyTreeRecord | undefined = await tx.getTree(ref as never, fullOptions as never)
		const lazy: AnyTreeRecord | undefined = await tx.getTree(ref as never, options as never)
		return { full, lazy }
	})
	expect(committedLazy).toEqual(cutTree({ tree: committedFull as AnyTreeRecord, depth, expanded }))
	expect(staged.lazy).toEqual(cutTree({ tree: staged.full as AnyTreeRecord, depth, expanded }))
	expect(toShape(staged.lazy as AnyTreeRecord)).toEqual(testCase.expectedShape)
}

function leafShape(tagName: string): { tagName: string; tree: [] } {
	return { tagName, tree: [] }
}

describe('getTree - depth through hoisted elements is the full tree cut past the visible levels', () => {
	const a1 = { tagName: 'A', id: 'a1' } as const
	const testCases: TestCases<LazyTreeCase<TransparentTestDialecteConfig>> = {
		'depth 1, nothing staged → the full tree cut past one visible level': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { depth: 1 },
			expectedShape: {
				tagName: 'A',
				tree: [leafShape('AA_2'), leafShape('AAA_1'), leafShape('AAA_2')],
			},
		},
		'depth 2, a staged child created in the wrapper → the full tree cut past two visible levels': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { depth: 2 },
			stage: async function stageCreate(tx) {
				await tx.addChild(
					{ tagName: 'AA_1', id: 'aa1' },
					{ tagName: 'AAA_3', id: '0-0-0-0-1', attributes: { 'ext:aAAA_3': 'v' } },
				)
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_2', tree: [leafShape('AAA_3')] },
					{ tagName: 'AAA_1', tree: [leafShape('AAAA_1')] },
					leafShape('AAA_2'),
					leafShape('AAA_3'),
				],
			},
		},
		'depth 1, a staged delete and update in the wrapper → the full tree cut past one visible level':
			{
				sourceXml: LAZY_TRANSPARENT_XML,
				ref: a1,
				options: { depth: 1 },
				stage: async function stageDeleteAndUpdate(tx) {
					await tx.delete({ tagName: 'AAA_2', id: 'aaa2' })
					await tx.update({ tagName: 'AAA_1', id: 'aaa1' }, { attributes: { aAAA_1: 'new' } })
				},
				expectedShape: { tagName: 'A', tree: [leafShape('AA_2'), leafShape('AAA_1')] },
			},
		'depth 2 on the document root, a staged move between wrappers → the full tree cut past two visible levels':
			{
				sourceXml: LAZY_TRANSPARENT_XML,
				ref: { tagName: 'Root' },
				options: { depth: 2 },
				stage: async function stageMove(tx) {
					await tx.any.move(
						{ tagName: 'AAA_2', id: 'aaa2' },
						{ parent: { tagName: 'AA_1', id: 'aa3' } },
					)
				},
				expectedShape: {
					tagName: 'Root',
					tree: [
						{ tagName: 'A', tree: [leafShape('AA_2'), leafShape('AAA_1')] },
						{ tagName: 'A', tree: [leafShape('AAA_1'), leafShape('AAA_2')] },
						leafShape('B'),
					],
				},
			},
		'depth 2 on the document root → the full tree cut past two visible levels': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: { tagName: 'Root' },
			options: { depth: 2 },
			expectedShape: {
				tagName: 'Root',
				tree: [
					{
						tagName: 'A',
						tree: [leafShape('AA_2'), leafShape('AAA_1'), leafShape('AAA_2')],
					},
					{ tagName: 'A', tree: [leafShape('AAA_1')] },
					leafShape('B'),
				],
			},
		},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act: readsTheFullTreeCutAtTheBoundary })
})

describe('getTree - expanded is the full tree cut to the opened nodes', () => {
	const a1 = { tagName: 'A', id: 'a1' } as const
	const a2 = { tagName: 'A', id: 'a2' } as const
	const testCases: TestCases<LazyTreeCase<TransparentTestDialecteConfig>> = {
		'nothing staged → the full tree cut to the opened nodes': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aa2', 'aaa1']) },
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_2', tree: [leafShape('AAA_3')] },
					{ tagName: 'AAA_1', tree: [leafShape('AAAA_1')] },
					leafShape('AAA_2'),
				],
			},
		},
		'a staged child created in the wrapper, listed → the full tree cut to the opened nodes': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aa2', '0-0-0-0-1']) },
			stage: async function stageCreate(tx) {
				await tx.addChild(
					{ tagName: 'AA_1', id: 'aa1' },
					{ tagName: 'AAA_3', id: '0-0-0-0-1', attributes: { 'ext:aAAA_3': 'v' } },
				)
				await tx.addChild(
					{ tagName: 'AAA_3', id: '0-0-0-0-1' },
					{ tagName: 'AAAA_1', attributes: { aAAAA_1: 'v' } },
				)
			},
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_2', tree: [leafShape('AAA_3')] },
					leafShape('AAA_1'),
					leafShape('AAA_2'),
					{ tagName: 'AAA_3', tree: [leafShape('AAAA_1')] },
				],
			},
		},
		'a staged delete and update of opened nodes → the full tree cut to the opened nodes': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aaa1', 'aaa2']) },
			stage: async function stageDeleteAndUpdate(tx) {
				await tx.delete({ tagName: 'AAA_2', id: 'aaa2' })
				await tx.update({ tagName: 'AAAA_1', id: 'aaaa1' }, { attributes: { aAAAA_1: 'new' } })
			},
			expectedShape: {
				tagName: 'A',
				tree: [leafShape('AA_2'), { tagName: 'AAA_1', tree: [leafShape('AAAA_1')] }],
			},
		},
		'a staged move into another wrapper → the full tree cut to the opened nodes': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a2,
			options: { expanded: new Set(['a2']) },
			stage: async function stageMove(tx) {
				await tx.any.move(
					{ tagName: 'AAA_3', id: 'aaa3' },
					{ parent: { tagName: 'AA_1', id: 'aa3' } },
				)
			},
			expectedShape: {
				tagName: 'A',
				tree: [leafShape('AAA_1'), leafShape('AAA_3')],
			},
		},
		'unwrap [] with the wrapper listed → the full tree cut to the opened nodes': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aa1']), unwrap: [] },
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_1', tree: [leafShape('AAA_1'), leafShape('AAA_2')] },
					leafShape('AA_2'),
				],
			},
		},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act: readsTheFullTreeCutAtTheBoundary })
})

/**
 * Every id listed answers the full tree, with the case's options; every id but the root's answers the root alone,
 * committed and with a staged write outside the tree.
 */
async function opensTheFullTreeWithEveryId<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, GetTreeCase<GenericConfig>>): Promise<void> {
	const options = testCase.options ?? {}
	const full: AnyTreeRecord | undefined = await source.query.getTree(testCase.ref, options)
	const ids = idsOf(full as AnyTreeRecord)
	const everyId = await source.query.getTree(testCase.ref, { ...options, expanded: new Set(ids) })
	const butTheRoot = await source.transaction(async function readWithStagedWrite(tx) {
		await tx.any.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: {} })
		return tx.any.getTree(
			testCase.ref as never,
			{ ...options, expanded: new Set(ids.slice(1)) } as never,
		)
	})
	expect(everyId).toEqual(full)
	expect((butTheRoot as AnyTreeRecord | undefined)?.tree).toEqual([])
}

describe('getTree - expanded with every id is the full tree, every getTree table case', () => {
	runTestCases.withoutExport({ testCases: GET_TREE_CASES, act: opensTheFullTreeWithEveryId })
	createTestRunner<RecursiveTestDialecteConfig>({
		dialecteConfig: RECURSIVE_CONFIG,
	}).withoutExport({ testCases: AUTO_RECURSION_CASES, act: opensTheFullTreeWithEveryId })
	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases: TRANSPARENT_CASES, act: opensTheFullTreeWithEveryId })
})
