import { GET_TREE_CASES, toShape } from './get-tree.fixtures'
import { AUTO_RECURSION_CASES, RECURSIVE_CONFIG } from './get-tree.recursion.fixtures'
import { TRANSPARENT_CASES, TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { createTestRunner, runTestCases } from '@/test'

import type {
	GetTreeCase,
	RecursiveTestDialecteConfig,
	TransparentTestDialecteConfig,
} from './get-tree.fixtures.types'
import type { ActParams } from '@/test'
import type { AnyDialecteConfig, AnyTreeRecord } from '@/types'

/**
 * Parity runner over the getTree tables: each case read inside a transaction holding a staged write outside its
 * tree (a new A under the root) answers the same tree, field by field, as the committed read, and the expected shape.
 */
async function readsTheSameTreeWithStagedWrites<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, GetTreeCase<GenericConfig>>): Promise<void> {
	const committed = await source.query.getTree(testCase.ref, testCase.options)
	const staged = await source.transaction(async function readWithStagedWrite(tx) {
		await tx.any.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: {} })
		return tx.any.getTree(testCase.ref, testCase.options as never)
	})
	expect(staged).toEqual(committed)
	expect(toShape(staged as AnyTreeRecord)).toEqual(testCase.expectedShape)
}

describe('getTree - parity with staged writes pending', () => {
	runTestCases.withoutExport({ testCases: GET_TREE_CASES, act: readsTheSameTreeWithStagedWrites })
})

describe('getTree - parity with staged writes pending, auto-recursion', () => {
	createTestRunner<RecursiveTestDialecteConfig>({
		dialecteConfig: RECURSIVE_CONFIG,
	}).withoutExport({ testCases: AUTO_RECURSION_CASES, act: readsTheSameTreeWithStagedWrites })
})

describe('getTree - parity with staged writes pending, transparent elements', () => {
	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases: TRANSPARENT_CASES, act: readsTheSameTreeWithStagedWrites })
})
