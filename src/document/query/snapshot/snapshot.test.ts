import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestProject,
	runTestCases,
	TEST_DIALECTE_CONFIG,
} from '@/test'

import type { Document, GetSnapshotOptions, OmitEntry, RefOrRecord } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { AnyTreeRecord, ElementsOf } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type Shape = { tagName: string; status: string; tree: Shape[] }

function toShape(record: AnyTreeRecord): Shape {
	return {
		tagName: record.tagName,
		status: record.status,
		tree: record.tree.map((child) => toShape(child as AnyTreeRecord)),
	}
}

function tagNames(record: AnyTreeRecord): string[] {
	return [record.tagName, ...record.tree.flatMap((child) => tagNames(child as AnyTreeRecord))]
}

function findNode(record: AnyTreeRecord, tagName: string): AnyTreeRecord | undefined {
	if (record.tagName === tagName) return record
	for (const child of record.tree) {
		const found = findNode(child as AnyTreeRecord, tagName)
		if (found) return found
	}
	return undefined
}

// Transaction handed to a prepared block, derived from the runner's source doc.
type StageTx = Parameters<
	Parameters<ActParams<TestDialecteConfig, BaseXmlTestCase>['source']['prepare']>[0]
>[0]

async function withProject(
	sourceXml: string,
	run: (source: Document<TestDialecteConfig>) => Promise<void>,
): Promise<void> {
	const { project, source } = await createTestProject({
		sourceXml,
		dialecteConfig: TEST_DIALECTE_CONFIG,
	})
	try {
		await run(source.document)
	} finally {
		await project.destroy()
	}
}

const SIMPLE = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="parent">
			<AA_1 ${customId}="aa1" aAA_1="child" />
		</A>
	</Root>
`

const DEEP = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="p">
			<AA_1 ${customId}="aa1" aAA_1="target">
				<AAA_1 ${customId}="aaa1" aAAA_1="below" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="sibling" />
		</A>
	</Root>
`

const FILTER = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="p">
			<AA_1 ${customId}="aa1" aAA_1="x">
				<AAA_1 ${customId}="aaa1" aAAA_1="y" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="z" />
		</A>
	</Root>
`

const SPINE = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="p">
			<AA_1 ${customId}="aa1" aAA_1="p">
				<AAA_1 ${customId}="aaa1" aAAA_1="ref">
					<AAAA_1 ${customId}="aaaa1" aAAAA_1="leaf" />
				</AAA_1>
				<AAA_2 ${customId}="aaa2" aAAA_2="sib-ref" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="sib-up">
				<AAA_3 ${customId}="aaa3" aAAA_3="deep" />
			</AA_2>
		</A>
	</Root>
`

// ── Table-driven tree reads (no staging, tree output) ────────────────────────
//
// Restricting `options.as` to `'tree'` keeps the call on the first getSnapshot
// overload, so the result is typed `AnyTreeRecord` with no cast. Staged, xml and
// mid-transaction cases stay as focused `it`s below (heterogeneous flows + the
// overloaded `as` make them clearer with literal calls).

describe('getSnapshot — tree reads (table)', () => {
	type TestCase = BaseXmlTestCase & {
		options?: GetSnapshotOptions<TestDialecteConfig> & { as?: 'tree' }
		expectShape?: Shape
		expectRootTag?: string
		expectChildTags?: string[]
		expectChildless?: string[]
	}

	const testCases: TestCases<TestCase> = {
		'no ref → whole document tree from the root': {
			sourceXml: SIMPLE,
			expectShape: {
				tagName: 'Root',
				status: 'unchanged',
				tree: [
					{
						tagName: 'A',
						status: 'unchanged',
						tree: [{ tagName: 'AA_1', status: 'unchanged', tree: [] }],
					},
				],
			},
		},
		'ancestors:1 → parent -> target spine': {
			sourceXml: DEEP,
			options: { ref: { tagName: 'AA_1', id: 'aa1' }, ancestors: 1 },
			expectRootTag: 'A',
			expectChildTags: ['AA_1'],
		},
		'siblings:true → shallow siblings under the parent': {
			sourceXml: DEEP,
			options: { ref: { tagName: 'AA_1', id: 'aa1' }, siblings: true },
			expectRootTag: 'A',
			expectChildTags: ['AA_1', 'AA_2'],
			expectChildless: ['AA_2'],
		},
		'siblings span the whole ancestor spine (shallow)': {
			sourceXml: SPINE,
			options: { ref: { tagName: 'AAA_1', id: 'aaa1' }, ancestors: 2, siblings: true },
			expectShape: {
				tagName: 'A',
				status: 'unchanged',
				tree: [
					{
						tagName: 'AA_1',
						status: 'unchanged',
						tree: [
							{
								tagName: 'AAA_1',
								status: 'unchanged',
								tree: [{ tagName: 'AAAA_1', status: 'unchanged', tree: [] }],
							},
							// `ref`'s own sibling, shallow
							{ tagName: 'AAA_2', status: 'unchanged', tree: [] },
						],
					},
					// `AA_1`'s sibling (one level up the spine), shallow
					{ tagName: 'AA_2', status: 'unchanged', tree: [] },
				],
			},
		},
		'siblings:{expand:true} keeps the siblings subtrees': {
			sourceXml: SPINE,
			options: {
				ref: { tagName: 'AAA_1', id: 'aaa1' },
				ancestors: 2,
				siblings: { expand: true },
			},
			expectShape: {
				tagName: 'A',
				status: 'unchanged',
				tree: [
					{
						tagName: 'AA_1',
						status: 'unchanged',
						tree: [
							{
								tagName: 'AAA_1',
								status: 'unchanged',
								tree: [{ tagName: 'AAAA_1', status: 'unchanged', tree: [] }],
							},
							{ tagName: 'AAA_2', status: 'unchanged', tree: [] },
						],
					},
					// expanded: AA_2 keeps its child instead of being shallow
					{
						tagName: 'AA_2',
						status: 'unchanged',
						tree: [{ tagName: 'AAA_3', status: 'unchanged', tree: [] }],
					},
				],
			},
		},
		'depth:1 → stops one level below the ref': {
			sourceXml: DEEP,
			options: { ref: { tagName: 'A', id: 'a1' }, depth: 1 },
			expectRootTag: 'A',
			expectChildTags: ['AA_1', 'AA_2'],
			expectChildless: ['AA_1'],
		},
		'depth without ref → root + direct children only': {
			sourceXml: DEEP,
			options: { depth: 1 },
			expectRootTag: 'Root',
			expectChildTags: ['A'],
			expectChildless: ['A'],
		},
		'omit → drops the matching tagName': {
			sourceXml: FILTER,
			options: { ref: { tagName: 'A', id: 'a1' }, omit: ['AA_1'] },
			expectRootTag: 'A',
			expectChildTags: ['AA_2'],
		},
		'omit with where → drops only matching records': {
			sourceXml: FILTER,
			options: { ref: { tagName: 'A', id: 'a1' }, omit: [{ AA_1: { where: { aAA_1: 'x' } } }] },
			expectChildTags: ['AA_2'],
		},
		'omit scope:children → keeps node, stops below it': {
			sourceXml: FILTER,
			options: {
				ref: { tagName: 'A', id: 'a1' },
				omit: [{ AA_1: { where: { aAA_1: 'x' }, scope: 'children' } }],
			},
			expectChildTags: ['AA_1', 'AA_2'],
			expectChildless: ['AA_1'],
		},
		'unwrap → removes the layer and promotes its children': {
			sourceXml: FILTER,
			options: { ref: { tagName: 'A', id: 'a1' }, unwrap: ['AA_1'] },
			// config order: AA_2 is a declared child of A, the promoted AAA_1 is not → last
			expectChildTags: ['AA_2', 'AAA_1'],
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const tree = await source.query.getSnapshot(testCase.options)

		if (testCase.expectShape) expect(toShape(tree)).toEqual(testCase.expectShape)
		if (testCase.expectRootTag) expect(tree.tagName).toBe(testCase.expectRootTag)
		if (testCase.expectChildTags) {
			expect(tree.tree.map((n) => n.tagName)).toEqual(testCase.expectChildTags)
		}
		for (const tag of testCase.expectChildless ?? []) {
			expect(findNode(tree, tag)?.tree).toEqual([])
		}
	}

	runTestCases.withoutExport({ testCases, act })
})

// ── Staged reads (prepared transaction, store untouched until commit) ─────────

describe('getSnapshot — staged reads', () => {
	it('reflects a staged addChild via prepared.query without touching the store', async () => {
		await withProject(SIMPLE, async (source) => {
			const prepared = await source.prepare(async (tx) => {
				await tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'AA_2', attributes: { aAA_2: 'staged' } },
				)
			})

			const staged = (await prepared.query.getSnapshot()) as AnyTreeRecord
			expect(tagNames(staged)).toContain('AA_2')

			// Store is untouched until commit.
			const committed = (await source.query.getSnapshot()) as AnyTreeRecord
			expect(tagNames(committed)).not.toContain('AA_2')

			prepared.discard()
		})
	})
})

describe('getSnapshot — reachable mid-transaction', () => {
	it('reflects staged changes when called on the live transaction', async () => {
		await withProject(SIMPLE, async (source) => {
			await source.transaction(async (tx) => {
				await tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'AA_2', attributes: { aAA_2: 'mid' } },
				)
				const tree = (await tx.getSnapshot()) as AnyTreeRecord
				expect(tagNames(tree)).toContain('AA_2')
			})
		})
	})
})

// ── XML output via the runner (assertOn: 'custom') ───────────────────────────
//
// The act produces an `as: 'both'` snapshot, asserts tree shape inline, and
// returns the snapshot xml as `assertOn: 'custom'` so the runner asserts the
// XPath `expectedQueries`/`unexpectedQueries` against it — same matcher used for
// document exports, now over a custom snapshot string.

describe('getSnapshot — xml output (table)', () => {
	type TestCase = BaseXmlTestCase & {
		stage?: (tx: StageTx) => Promise<void>
		ref?: RefOrRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		omit?: OmitEntry<TestDialecteConfig>[]
		unwrap?: ElementsOf<TestDialecteConfig>[]
		includeDeleted?: boolean
		expectTreeIncludes?: string[]
		expectTreeExcludes?: string[]
		expectTreeStatus?: Record<string, string>
	}

	const testCases: TestCases<TestCase> = {
		'staged addChild appears in tree and xml': {
			sourceXml: SIMPLE,
			stage: async (tx) => {
				await tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'AA_2', attributes: { aAA_2: 'staged' } },
				)
			},
			expectTreeIncludes: ['AA_2'],
			expectedQueries: ['//default:AA_2[@aAA_2="staged"]'],
		},
		'staged delete is absent from tree and xml': {
			sourceXml: SIMPLE,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_1', id: 'aa1' })
			},
			expectTreeExcludes: ['AA_1'],
			unexpectedQueries: ['//default:AA_1'],
		},
		'includeDeleted → tombstone in tree, still absent from xml': {
			sourceXml: SIMPLE,
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_1', id: 'aa1' })
			},
			includeDeleted: true,
			expectTreeStatus: { AA_1: 'deleted' },
			unexpectedQueries: ['//default:AA_1'],
		},
		'includeDeleted → whole deleted subtree as tombstones, absent from xml': {
			sourceXml: SIMPLE,
			stage: async (tx) => {
				await tx.delete({ tagName: 'A', id: 'a1' })
			},
			includeDeleted: true,
			expectTreeStatus: { A: 'deleted', AA_1: 'deleted' },
			unexpectedQueries: ['//default:A', '//default:AA_1'],
		},
		'scoped includeDeleted → deleted descendant tombstone under the ref, absent from xml': {
			sourceXml: DEEP,
			ref: { tagName: 'A', id: 'a1' },
			stage: async (tx) => {
				await tx.delete({ tagName: 'AA_1', id: 'aa1' })
			},
			includeDeleted: true,
			expectTreeIncludes: ['AA_2'],
			expectTreeStatus: { AA_1: 'deleted' },
			expectedQueries: ['//default:AA_2'],
			unexpectedQueries: ['//default:AA_1'],
		},
		'created-then-deleted in the same tx → no tombstone, absent from tree and xml': {
			sourceXml: SIMPLE,
			stage: async (tx) => {
				await tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'AA_2', id: '0-0-0-0-2', attributes: { aAA_2: 'temp' } },
				)
				await tx.delete({ tagName: 'AA_2', id: '0-0-0-0-2' })
			},
			includeDeleted: true,
			expectTreeExcludes: ['AA_2'],
			unexpectedQueries: ['//default:AA_2'],
		},
		'scoped xml emits a fragment rooted at the ref (no document root)': {
			sourceXml: DEEP,
			ref: { tagName: 'AA_1', id: 'aa1' },
			expectedQueries: ['//default:AA_1[@aAA_1="target"]'],
			unexpectedQueries: ['//default:Root'],
		},
		'omit shapes the tree only — xml keeps the full document': {
			sourceXml: FILTER,
			ref: { tagName: 'A', id: 'a1' },
			omit: ['AA_1'],
			expectTreeExcludes: ['AA_1'],
			expectedQueries: ['//default:AA_1[@aAA_1="x"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const options = {
			ref: testCase.ref,
			omit: testCase.omit,
			unwrap: testCase.unwrap,
			includeDeleted: testCase.includeDeleted,
			as: 'both' as const,
		}

		let snapshot: { tree: AnyTreeRecord; xmlString: string }
		if (testCase.stage) {
			const prepared = await source.prepare(testCase.stage)
			snapshot = await prepared.query.getSnapshot(options)
			prepared.discard()
		} else {
			snapshot = await source.query.getSnapshot(options)
		}

		const { tree, xmlString } = snapshot
		for (const tag of testCase.expectTreeIncludes ?? []) {
			expect(tagNames(tree)).toContain(tag)
		}
		for (const tag of testCase.expectTreeExcludes ?? []) {
			expect(tagNames(tree)).not.toContain(tag)
		}
		for (const [tag, status] of Object.entries(testCase.expectTreeStatus ?? {})) {
			expect(findNode(tree, tag)?.status).toBe(status)
		}

		return { assertOn: 'custom', xmlString }
	}

	runTestCases.withExport({ testCases, act })
})

describe('getSnapshot — xml declaration toggle', () => {
	it('includes the XML declaration by default', async () => {
		await withProject(SIMPLE, async (source) => {
			const xml = await source.query.getSnapshot({ as: 'xml' })
			expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
		})
	})

	it('omits the XML declaration when includeXmlDeclaration is false', async () => {
		await withProject(SIMPLE, async (source) => {
			const xml = await source.query.getSnapshot({ as: 'xml', includeXmlDeclaration: false })
			expect(xml.startsWith('<?xml')).toBe(false)
			expect(xml).toContain('<Root')
		})
	})

	it('applies the toggle to the xml side of as: both', async () => {
		await withProject(SIMPLE, async (source) => {
			const { xmlString } = await source.query.getSnapshot({
				as: 'both',
				includeXmlDeclaration: false,
			})
			expect(xmlString.startsWith('<?xml')).toBe(false)
		})
	})
})
