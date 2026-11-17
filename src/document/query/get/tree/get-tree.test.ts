import { GET_TREE_CASES, toShape } from './get-tree.fixtures'
import { AUTO_RECURSION_CASES, RECURSIVE_CONFIG } from './get-tree.recursion.fixtures'
import { TRANSPARENT_CASES, TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
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
import type { Document, GetTreeParams, Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, AnyTreeRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

async function readsExpectedShape<GenericConfig extends AnyDialecteConfig>({
	source,
	testCase,
}: ActParams<GenericConfig, GetTreeCase<GenericConfig>>): Promise<void> {
	const result = await source.query.getTree(testCase.ref, testCase.options)
	expect(result).toBeDefined()
	expect(toShape(result as AnyTreeRecord)).toEqual(testCase.expectedShape)
}

describe('getTree', () => {
	runTestCases.withoutExport({ testCases: GET_TREE_CASES, act: readsExpectedShape })
})

describe('getTree - error handling', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options?: GetTreeParams<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
	}

	const testCases: Record<string, TestCase> = {
		'non-existent ref - throws ELEMENT_NOT_FOUND': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v" />
				</Root>
			`,
			ref: { tagName: 'A', id: 'non-existent' },
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		await expect(source.query.getTree(testCase.ref, testCase.options)).rejects.toThrow()
	}

	runTestCases.withoutExport({ testCases, act })
})

describe('getTree - auto-recursion', () => {
	createTestRunner<RecursiveTestDialecteConfig>({
		dialecteConfig: RECURSIVE_CONFIG,
	}).withoutExport({ testCases: AUTO_RECURSION_CASES, act: readsExpectedShape })
})

describe('getTree - transparent elements', () => {
	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases: TRANSPARENT_CASES, act: readsExpectedShape })
})

describe('getTree - a ref naming another tag than its record', () => {
	type TestCase = BaseXmlTestCase & {
		read: (source: Document<TestDialecteConfig>) => Promise<unknown>
	}

	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="v" />
		</Root>
	`
	const mismatched = { tagName: 'B', id: 'a1' } as const

	const testCases: Record<string, TestCase> = {
		'B named by the id of an A, with a select → ELEMENT_NOT_FOUND': {
			sourceXml,
			read: (source) => source.query.getTree(mismatched, { select: { BB_1: true } }),
		},
		'B named by the id of a staged A, with a select → ELEMENT_NOT_FOUND': {
			sourceXml,
			read: (source) =>
				source.transaction(async function readStagedMismatch(tx) {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: 'w' } })
					return tx.getTree(mismatched, { select: { BB_1: true } })
				}),
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const error = await testCase.read(source).then(
			() => undefined,
			(thrown: unknown) => toDialecteError(thrown),
		)
		expect(error?.key).toEqual('ELEMENT_NOT_FOUND')
	}

	runTestCases.withoutExport({ testCases, act })
})
