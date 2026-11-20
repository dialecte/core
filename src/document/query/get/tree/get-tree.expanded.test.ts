import LAZY_TRANSPARENT_XML from './fixtures/wrapped-children.xml?raw'
import { toShape } from './get-tree.fixtures'
import { TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect } from 'vitest'

import { createTestRunner } from '@/test'

import type {
	LazyTreeCase,
	TransparentTestDialecteConfig,
	TreeShape,
} from './get-tree.fixtures.types'
import type { ActParams, TestCases } from '@/test'
import type { AnyTreeRecord } from '@/types'

const a1 = { tagName: 'A', id: 'a1' } as const

function leaf(tagName: string): TreeShape {
	return { tagName, tree: [] }
}

async function opensOnlyTheListedIds({
	source,
	testCase,
}: ActParams<
	TransparentTestDialecteConfig,
	LazyTreeCase<TransparentTestDialecteConfig>
>): Promise<void> {
	const tree = (await source.query.getTree(testCase.ref, testCase.options)) as AnyTreeRecord
	expect(toShape(tree)).toEqual(testCase.expectedShape)
}

describe('getTree - expanded opens only the listed ids, one level each, from the root', () => {
	const testCases: TestCases<LazyTreeCase<TransparentTestDialecteConfig>> = {
		'the root and two ids on two levels → those three open, every other node with an empty tree': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aa2', 'aaa1']) },
			expectedShape: {
				tagName: 'A',
				tree: [
					{ tagName: 'AA_2', tree: [leaf('AAA_3')] },
					{ tagName: 'AAA_1', tree: [leaf('AAAA_1')] },
					leaf('AAA_2'),
				],
			},
		},
		'an empty set → the root alone': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set() },
			expectedShape: leaf('A'),
		},
		'a listed id under a node that does not open → never reached': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aaa3']) },
			expectedShape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2')] },
		},
		'a root not listed → the root alone, its listed descendants never reached': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: { tagName: 'Root' },
			options: { expanded: new Set(['a1', 'aa2']) },
			expectedShape: leaf('Root'),
		},
		'a chain of hoisted wrappers under an opened node → open, their children hoisted with an empty tree':
			{
				sourceXml: LAZY_TRANSPARENT_XML,
				ref: a1,
				options: { expanded: new Set(['a1']), unwrap: ['AA_1', 'AAA_1'] },
				expectedShape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAAA_1'), leaf('AAA_2')] },
			},
		'expanded and depth together → a node opens only when both allow it': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { expanded: new Set(['a1', 'aa2', 'aaa3']), depth: 2 },
			expectedShape: {
				tagName: 'A',
				tree: [{ tagName: 'AA_2', tree: [leaf('AAA_3')] }, leaf('AAA_1'), leaf('AAA_2')],
			},
		},
		'an omit scope children on a listed id → stops it': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: {
				expanded: new Set(['a1', 'aa2']),
				omit: [{ AA_2: { where: { aAA_2: 'v' }, scope: 'children' } }],
			},
			expectedShape: { tagName: 'A', tree: [leaf('AA_2'), leaf('AAA_1'), leaf('AAA_2')] },
		},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act: opensOnlyTheListedIds })
})
