import LAZY_TRANSPARENT_XML from './fixtures/wrapped-children.xml?raw'
import { toShape } from './get-tree.fixtures'
import { TRANSPARENT_CONFIG } from './get-tree.transparent.fixtures'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestProject,
	createTestRunner,
} from '@/test'

import type { TransparentTestDialecteConfig, TreeShape } from './get-tree.fixtures.types'
import type { GetTreeParams, Ref } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases } from '@/test'
import type { AnyTreeRecord, ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

// A > AA_1 > AAA_1 (three levels) so depth boundaries are observable.
const sourceXml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v" />
			</AA_1>
		</A>
	</Root>
`

describe('getTree — depth', () => {
	it('depth:0 returns the node alone (empty tree, children refs kept)', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 0 })
			expect(tree?.tree).toEqual([])
			expect(tree?.children.length).toBe(1) // hasChildren via refs, though unexpanded
		} finally {
			await project.destroy()
		}
	})

	it('depth:1 expands one level; deeper nodes keep children refs but an empty tree', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
			expect(tree?.tree.map((child) => child.tagName)).toEqual(['AA_1'])
			const aa1 = tree?.tree[0]
			expect(aa1?.tree).toEqual([]) // AAA_1 not expanded at depth 1
			expect(aa1?.children.length).toBe(1) // but hasChildren
		} finally {
			await project.destroy()
		}
	})

	it('depth undefined expands the full tree (unchanged behaviour)', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' })
			expect(tree?.tree[0]?.tree.map((child) => child.tagName)).toEqual(['AAA_1'])
		} finally {
			await project.destroy()
		}
	})

	it('bounded depth reads only the needed levels (getMany, not the whole document)', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			doc.perf.reset()
			await doc.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
			const report = doc.perf.report()
			expect(report['core::store::getByDocumentId']?.count ?? 0).toBe(0)
			expect(report['core::store::getMany']?.count ?? 0).toBeGreaterThanOrEqual(1)
		} finally {
			await project.destroy()
		}
	})

	it('bounded depth reflects staged writes inside a transaction', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			await source.document.transaction(async (tx) => {
				await tx.any.addChild({ tagName: 'A', id: 'a1' }, { tagName: 'AA_2', attributes: {} })
				const tree = await tx.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
				expect(tree?.tree.map((child) => child.tagName).sort()).toEqual(['AA_1', 'AA_2'])
			})
		} finally {
			await project.destroy()
		}
	})

	it('bounded depth with pending staged writes reads only the needed levels, staged records overlaid', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const report = await source.document.transaction(async (tx) => {
				await tx.any.addChild({ tagName: 'A', id: 'a1' }, { tagName: 'AA_2', attributes: {} })
				tx.perf.reset()
				await tx.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
				return tx.perf.report()
			})
			expect({
				getByDocumentId: report['core::store::getByDocumentId']?.count ?? 0,
				getMany: report['core::store::getMany']?.count ?? 0,
			}).toEqual({ getByDocumentId: 0, getMany: 1 })
		} finally {
			await project.destroy()
		}
	})
})

type HoistedDepthCase = BaseXmlTestCase & {
	ref: Ref<TransparentTestDialecteConfig, ElementsOf<TransparentTestDialecteConfig>>
	options: GetTreeParams<TransparentTestDialecteConfig, ElementsOf<TransparentTestDialecteConfig>>
	expected: { shape: TreeShape; childRefs: Record<string, number> }
}

/** The ids of a tree with the count of their `children` refs, every node past the root. */
function childRefsOf(tree: AnyTreeRecord): Record<string, number> {
	return Object.fromEntries(
		tree.tree.flatMap((child) => [
			[child.id, child.children.length],
			...Object.entries(childRefsOf(child as AnyTreeRecord)),
		]),
	)
}

async function countsVisibleLevelsOnly({
	source,
	testCase,
}: ActParams<TransparentTestDialecteConfig, HoistedDepthCase>): Promise<void> {
	const tree = (await source.query.getTree(testCase.ref, testCase.options)) as AnyTreeRecord
	expect({ shape: toShape(tree), childRefs: childRefsOf(tree) }).toEqual(testCase.expected)
}

describe('getTree - depth counts the visible levels, hoisted elements do not use one up', () => {
	const a1 = { tagName: 'A', id: 'a1' } as const
	const testCases: TestCases<HoistedDepthCase> = {
		'depth 1 on a parent of a transparent wrapper → its visible children and the wrapper children hoisted, an empty tree and their refs':
			{
				sourceXml: LAZY_TRANSPARENT_XML,
				ref: a1,
				options: { depth: 1 },
				expected: {
					shape: {
						tagName: 'A',
						tree: [
							{ tagName: 'AA_2', tree: [] },
							{ tagName: 'AAA_1', tree: [] },
							{ tagName: 'AAA_2', tree: [] },
						],
					},
					childRefs: { aa2: 1, aaa1: 1, aaa2: 0 },
				},
			},
		'a chain of two hoisted wrappers → counts as zero levels': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { depth: 1, unwrap: ['AA_1', 'AAA_1'] },
			expected: {
				shape: {
					tagName: 'A',
					tree: [
						{ tagName: 'AA_2', tree: [] },
						{ tagName: 'AAAA_1', tree: [] },
						{ tagName: 'AAA_2', tree: [] },
					],
				},
				childRefs: { aa2: 1, aaaa1: 0, aaa2: 0 },
			},
		},
		'unwrap [] → the transparent element counts as a level, as before': {
			sourceXml: LAZY_TRANSPARENT_XML,
			ref: a1,
			options: { depth: 1, unwrap: [] },
			expected: {
				shape: {
					tagName: 'A',
					tree: [
						{ tagName: 'AA_1', tree: [] },
						{ tagName: 'AA_2', tree: [] },
					],
				},
				childRefs: { aa1: 2, aa2: 1 },
			},
		},
		'an explicit unwrap of a tag the dialecte does not make transparent → that tag does not count either':
			{
				sourceXml: LAZY_TRANSPARENT_XML,
				ref: a1,
				options: { depth: 1, unwrap: ['AA_2'] },
				expected: {
					shape: {
						tagName: 'A',
						tree: [
							{ tagName: 'AA_1', tree: [] },
							{ tagName: 'AAA_3', tree: [] },
						],
					},
					childRefs: { aa1: 2, aaa3: 1 },
				},
			},
	}

	createTestRunner<TransparentTestDialecteConfig>({
		dialecteConfig: TRANSPARENT_CONFIG,
	}).withoutExport({ testCases, act: countsVisibleLevelsOnly })
})
