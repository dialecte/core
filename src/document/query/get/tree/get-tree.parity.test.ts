import { GET_TREE_CASES, toShape } from './get-tree.fixtures'
import { AUTO_RECURSION_CASES, RECURSIVE_CONFIG } from './get-tree.recursion.fixtures'
import { TRANSPARENT_CASES, TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
	runTestCases,
} from '@/test'

import type {
	GetTreeCase,
	RecursiveTestDialecteConfig,
	TransparentTestDialecteConfig,
} from './get-tree.fixtures.types'
import type { Ref, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'
import type { AnyDialecteConfig, AnyTreeRecord } from '@/types'

/**
 * Parity runner over the getTree tables: each case read inside a transaction holding a staged write outside its
 * tree (a new A under the root) answers the same tree, field by field, as the committed read, and the expected shape.
 * A tree read from the root itself differs only in the root's own record (the staged A in its children, its status
 * updated): the root is compared without those two fields, its tree in full.
 */
async function readsTheSameTreeWithStagedWrites<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, GetTreeCase<GenericConfig>>): Promise<void> {
	const committed: AnyTreeRecord | undefined = await source.query.getTree(
		testCase.ref,
		testCase.options,
	)
	const staged: AnyTreeRecord | undefined = await source.transaction(
		async function readWithStagedWrite(tx) {
			await tx.any.addChild({ tagName: 'Root' }, { tagName: 'A', attributes: {} })
			return tx.any.getTree(testCase.ref, testCase.options as never)
		},
	)
	expect(withoutStagedParentFields({ tree: staged, ref: testCase.ref })).toEqual(
		withoutStagedParentFields({ tree: committed, ref: testCase.ref }),
	)
	expect(toShape(staged as AnyTreeRecord)).toEqual(testCase.expectedShape)
}

/** The tree as compared: without the root's children refs and status when the root is the staged write's parent. */
function withoutStagedParentFields(params: {
	tree: AnyTreeRecord | undefined
	ref: { tagName: string }
}): unknown {
	const { tree, ref } = params
	if (!tree || ref.tagName !== 'Root') return tree
	const { children: _children, status: _status, ...rest } = tree
	return rest
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

type SubtreeOracleCase = BaseXmlTestCase & {
	stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
	refs: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>[]
}

const oracleXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}>
		<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a1" aA="v">
			<AA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="aa1" aAA_1="v">
				<AAA_1 ${CUSTOM_RECORD_ID_ATTRIBUTE}="aaa1" aAAA_1="v" />
			</AA_1>
			<AA_2 ${CUSTOM_RECORD_ID_ATTRIBUTE}="aa2" aAA_2="v" />
		</A>
		<A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a2" aA="v">
			<AA_2 ${CUSTOM_RECORD_ID_ATTRIBUTE}="aa3" aAA_2="v" />
		</A>
	</Root>
`

/** The node of an id in a tree, depth first. */
function findNode(params: {
	tree: AnyTreeRecord | undefined
	id: string
}): AnyTreeRecord | undefined {
	const { tree, id } = params
	if (!tree) return undefined
	if (tree.id === id) return tree
	for (const child of tree.tree) {
		const found = findNode({ tree: child as AnyTreeRecord, id })
		if (found) return found
	}
	return undefined
}

/**
 * Oracle runner: a subtree root read with no options (by levels) answers, field by field, the node of the same id in
 * the document root's tree (one whole-document read), with the case's staged writes pending.
 */
async function readsTheSubtreeOfTheWholeDocumentRead({
	source,
	testCase,
}: ActParams<TestDialecteConfig, SubtreeOracleCase>): Promise<void> {
	const { subtrees, nodes } = await source.transaction(async function readBothWays(tx) {
		await testCase.stage(tx)
		const whole: AnyTreeRecord | undefined = await tx.any.getTree({ tagName: 'Root' })
		const read: (AnyTreeRecord | undefined)[] = await Promise.all(
			testCase.refs.map((ref) => tx.getTree(ref)),
		)
		return {
			subtrees: read,
			nodes: testCase.refs.map((ref) => findNode({ tree: whole, id: ref.id as string })),
		}
	})
	expect(nodes.every((node) => node !== undefined)).toBe(true)
	expect(subtrees).toEqual(nodes)
}

describe('getTree - a subtree root by levels answers its node of the whole-document read', () => {
	const a1 = { tagName: 'A', id: 'a1' } as const
	const a2 = { tagName: 'A', id: 'a2' } as const
	const testCases: TestCases<SubtreeOracleCase> = {
		'nothing staged → the same subtrees': {
			sourceXml: oracleXml,
			stage: async function stageNothing() {},
			refs: [a1, a2, { tagName: 'AA_1', id: 'aa1' }],
		},
		'a staged child created → the same subtrees': {
			sourceXml: oracleXml,
			stage: async function stageCreate(tx) {
				await tx.addChild(a1, { tagName: 'AA_2', id: '0-0-0-0-1', attributes: { aAA_2: 'v' } })
			},
			refs: [a1, a2],
		},
		'a staged delete and update → the same subtrees': {
			sourceXml: oracleXml,
			stage: async function stageDeleteAndUpdate(tx) {
				await tx.delete({ tagName: 'AAA_1', id: 'aaa1' })
				await tx.update({ tagName: 'AA_1', id: 'aa1' }, { attributes: { aAA_1: 'new' } })
			},
			refs: [a1, { tagName: 'AA_1', id: 'aa1' }],
		},
		'a staged move from a1 to a2 → the same subtrees': {
			sourceXml: oracleXml,
			stage: async function stageMove(tx) {
				await tx.any.move({ tagName: 'AA_2', id: 'aa2' }, { parent: a2 })
			},
			refs: [a1, a2],
		},
	}

	runTestCases.withoutExport({ testCases, act: readsTheSubtreeOfTheWholeDocumentRead })
})
