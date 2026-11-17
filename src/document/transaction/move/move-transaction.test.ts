import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'

import type { AnyRef } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { DialecteHooks } from '@/types'

const id = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

/** p1 holds k1, m (AAA_2 with mc and mc2) and s1 (AAA_3); p2 holds k2, t1 and t2 (AAA_3), then u (AAA_2). */
const twoParents = /* xml */ `
	<Root ${ns} ${id}="root">
		<A ${id}="a" aA="a">
			<AA_1 ${id}="aa1" aAA_1="aa1" />
			<AA_2 ${id}="p1" aAA_2="p1">
				<AAA_1 ${id}="k1" aAAA_1="k1" />
				<AAA_2 ${id}="m" aAAA_2="m">
					<AAAA_1 ${id}="mc" aAAAA_1="mc" />
					<AAAA_2 ${id}="mc2" aAAAA_2="mc2" />
				</AAA_2>
				<ext:AAA_3 ${id}="s1" ext:aAAA_3="s1" />
			</AA_2>
			<AA_2 ${id}="p2" aAA_2="p2">
				<AAA_1 ${id}="k2" aAAA_1="k2" />
				<ext:AAA_3 ${id}="t1" ext:aAAA_3="t1" />
				<ext:AAA_3 ${id}="t2" ext:aAAA_3="t2" />
				<AAA_2 ${id}="u" aAAA_2="u" />
			</AA_2>
		</A>
	</Root>
`

const ref = {
	p1: { tagName: 'AA_2', id: 'p1' },
	p2: { tagName: 'AA_2', id: 'p2' },
	m: { tagName: 'AAA_2', id: 'm' },
	s1: { tagName: 'AAA_3', id: 's1' },
	mc: { tagName: 'AAAA_1', id: 'mc' },
} as const satisfies Record<string, AnyRef>

type Source = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
type Tx = Parameters<Parameters<Source['transaction']>[0]>[0]

/** m, p1 and p2 after m moved under p2, and before. */
const moved = {
	m: ['p2', ['mc', 'mc2']],
	p1: ['a', ['k1', 's1']],
	p2: ['a', ['k2', 't1', 't2', 'u', 'm']],
}
const unmovedParents = {
	p1: ['a', ['k1', 'm', 's1']],
	p2: ['a', ['k2', 't1', 't2', 'u']],
}
const unmoved = { m: ['p1', ['mc', 'mc2']], ...unmovedParents }

type FoldCase = BaseXmlTestCase & {
	writes: (tx: Tx) => Promise<unknown>
	subject: AnyRef
	/** The subject, p1 and p2 once committed, by id: each its parent's id and its children's ids. */
	expected: Record<string, unknown>
}

describe('tx.move - folded with the other writes of its transaction', () => {
	const testCases: TestCases<FoldCase> = {
		'A to B then back to A in one transaction → no parent change at commit': {
			sourceXml: twoParents,
			writes: async (tx) => {
				await tx.any.move(ref.s1, { parent: ref.p2 })
				await tx.any.move(ref.s1, { parent: ref.p1 })
			},
			subject: ref.s1,
			expected: { s1: ['p1', []], ...unmovedParents },
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		},
		'move after create in one transaction → folds as created under the new parent': {
			sourceXml: twoParents,
			writes: async (tx) => {
				const created = await tx.any.addChild(ref.p1, {
					id: 'n',
					tagName: 'AAA_3',
					attributes: { 'ext:aAAA_3': 'n' },
				})
				await tx.any.move(created, { parent: ref.p2 })
			},
			subject: { tagName: 'AAA_3', id: 'n' },
			expected: {
				n: ['p2', []],
				p1: unmovedParents.p1,
				p2: ['a', ['k2', 't1', 't2', 'n', 'u']],
			},
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="n"]'],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="n"]'],
		},
		'move then update → one update with the new parent and the new attribute': {
			sourceXml: twoParents,
			writes: async (tx) => {
				await tx.any.move(ref.m, { parent: ref.p2 })
				await tx.any.update(ref.m, { attributes: { bAAA_2: 'b' } })
			},
			subject: ref.m,
			expected: moved,
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"][@bAAA_2="b"]'],
		},
		'update then move → one update with the new parent and the new attribute': {
			sourceXml: twoParents,
			writes: async (tx) => {
				await tx.any.update(ref.m, { attributes: { bAAA_2: 'b' } })
				await tx.any.move(ref.m, { parent: ref.p2 })
			},
			subject: ref.m,
			expected: moved,
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"][@bAAA_2="b"]'],
		},
	}

	runTestCases.withExport<FoldCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const committed = source.transaction(async (tx) => {
				await testCase.writes(tx)
			})
			await expect(committed).resolves.toBeUndefined()
			const placements = await placementsOf({ source, subject: testCase.subject })
			expect(placements).toEqual(testCase.expected)
			return {}
		},
	})
})

type ReadCase = BaseXmlTestCase & {
	read: (tx: Tx) => Promise<unknown>
	expected: unknown
}

describe('tx.move - staged reads after a move see the new tree', () => {
	const testCases: TestCases<ReadCase> = {
		'getRecord of the moved record → the new parent': {
			sourceXml: twoParents,
			read: async (tx) => (await tx.any.getRecord(ref.m))?.parent?.id,
			expected: 'p2',
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"]'],
		},
		'getTree of the new parent → the moved subtree under it, children in definition order': {
			sourceXml: twoParents,
			read: async (tx) => {
				const tree = await tx.any.getTree(ref.p2)
				const movedTree = tree?.tree.find((child) => child.id === ref.m.id)
				return [ids(tree?.tree), ids(movedTree?.tree)]
			},
			expected: [
				['k2', 'u', 'm', 't1', 't2'],
				['mc', 'mc2'],
			],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"]/default:AAAA_1'],
		},
		'findAncestors of a moved descendant → through the new parent': {
			sourceXml: twoParents,
			read: async (tx) => {
				const ancestors = await tx.any.findAncestors(ref.mc)
				return ids(ancestors)
			},
			expected: ['m', 'p2', 'a', 'root'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]//default:AAAA_1[@aAAAA_1="mc"]'],
		},
		'findDescendants of the new parent → the moved subtree among them': {
			sourceXml: twoParents,
			read: async (tx) => {
				const found = await tx.any.findDescendants(ref.p2)
				return Object.values(found)
					.flatMap((records) => ids(records) ?? [])
					.sort()
			},
			expected: ['k2', 'm', 'mc', 'mc2', 't1', 't2', 'u'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]//default:AAAA_2[@aAAAA_2="mc2"]'],
		},
		'findDescendants of the old parent → the moved subtree gone': {
			sourceXml: twoParents,
			read: async (tx) => {
				const found = await tx.any.findDescendants(ref.p1)
				return Object.values(found)
					.flatMap((records) => ids(records) ?? [])
					.sort()
			},
			expected: ['k1', 's1'],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p1"]//default:AAAA_1'],
		},
	}

	runTestCases.withExport<ReadCase>({
		testCases,
		act: async ({ source, testCase }) => {
			let seen: unknown
			const committed = source.transaction(async (tx) => {
				await tx.any.move(ref.m, { parent: ref.p2 })
				seen = await testCase.read(tx)
			})
			await expect(committed).resolves.toBeUndefined()
			expect(seen).toEqual(testCase.expected)
			return {}
		},
	})
})

/** The subject, the old parent and the new parent: each with its parent's id and its children's ids. */
async function placementsOf(params: {
	source: Source
	subject: AnyRef
}): Promise<Record<string, [string?, string[]?]>> {
	const records = await params.source.query.any.getRecords([params.subject, ref.p1, ref.p2])
	return Object.fromEntries(
		records.map((record) => [record?.id, [record?.parent?.id, ids(record?.children)]]),
	)
}

function ids(records: { id: string }[] | undefined): string[] | undefined {
	return records?.map((record) => record.id)
}

type HistoryCase = BaseXmlTestCase & {
	history: (params: {
		project: ActParams<TestDialecteConfig, BaseXmlTestCase>['project']
		documentId: string
	}) => Promise<void>
	expected: Record<string, unknown>
}

describe('tx.move - undo and redo of a committed move', () => {
	const testCases: TestCases<HistoryCase> = {
		'undo after commit → parent and both children orders restored': {
			sourceXml: twoParents,
			history: ({ project, documentId }) => project.undo(documentId),
			expected: unmoved,
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_2[@aAAA_2="m"]'],
		},
		'redo after undo → the move re-applied': {
			sourceXml: twoParents,
			history: async ({ project, documentId }) => {
				await project.undo(documentId)
				await project.redo(documentId)
			},
			expected: moved,
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"]'],
		},
	}

	runTestCases.withExport<HistoryCase>({
		testCases,
		act: async ({ project, source, testCase }) => {
			await expect(
				source.transaction((tx) => tx.any.move(ref.m, { parent: ref.p2 })),
			).resolves.toMatchObject({ ...ref.m, parent: { id: 'p2' } })
			await testCase.history({ project, documentId: source.documentId })
			const placements = await placementsOf({ source, subject: ref.m })
			expect(placements).toEqual(testCase.expected)
			return {}
		},
	})
})

describe('tx.move - a moved subtree written out, in definition order', () => {
	const order = [
		'//default:AA_2[@aAA_2="p2"]/*[1][@aAAA_1="k2"]',
		'//default:AA_2[@aAA_2="p2"]/*[2][@aAAA_2="u"]',
		'//default:AA_2[@aAA_2="p2"]/*[3][@aAAA_2="m"]/default:AAAA_2[@aAAAA_2="mc2"]',
		'//default:AA_2[@aAA_2="p2"]/*[4][@ext:aAAA_3="t1"]',
	]

	runTestCases.withExport<BaseXmlTestCase>({
		testCases: {
			'the snapshot of a committed move → the subtree under the new parent, in definition order': {
				sourceXml: twoParents,
				expectedQueries: order,
			},
		},
		act: async ({ source }) => {
			await expect(
				source.transaction((tx) => tx.any.move(ref.m, { parent: ref.p2 })),
			).resolves.toMatchObject({ ...ref.m, parent: { id: 'p2' } })
			return { assertOn: 'custom', xmlString: await source.query.getSnapshot({ as: 'xml' }) }
		},
	})

	runTestCases.withExport<BaseXmlTestCase>({
		testCases: {
			'the export of a committed move → the subtree under the new parent, in definition order': {
				sourceXml: twoParents,
				expectedQueries: order,
			},
		},
		act: async ({ source }) => {
			await expect(
				source.transaction((tx) => tx.any.move(ref.m, { parent: ref.p2 })),
			).resolves.toMatchObject({ ...ref.m, parent: { id: 'p2' } })
			return {}
		},
	})
})

/** An afterUpdated hook that marks aa1 (bAA_1="hooked") whenever it runs: an update calls it, a move must not. */
const markingHooks: DialecteHooks<TestDialecteConfig> = {
	afterUpdated: async function markAa1({ query }) {
		const aa1 = await query.any.getRecord({ tagName: 'AA_1', id: 'aa1' })
		if (!aa1) return []
		const marked = { ...aa1, attributes: [...aa1.attributes, { name: 'bAA_1', value: 'hooked' }] }
		return [{ status: 'updated', oldRecord: aa1, newRecord: marked }] as never
	},
}

type HookCase = BaseXmlTestCase & { write: (tx: Tx) => Promise<unknown> }

describe('tx.move - calls no hook', () => {
	const testCases: TestCases<HookCase> = {
		'an update → the afterUpdated hook marks aa1 (the hook is wired)': {
			sourceXml: twoParents,
			write: (tx) => tx.any.update(ref.s1, { attributes: { 'ext:bAAA_3': 'b' } }),
			expectedQueries: ['//default:AA_1[@aAA_1="aa1"][@bAA_1="hooked"]'],
		},
		'a move → no hook runs, aa1 unmarked': {
			sourceXml: twoParents,
			write: (tx) => tx.any.move(ref.s1, { parent: ref.p2 }),
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
			unexpectedQueries: ['//default:AA_1[@bAA_1="hooked"]'],
		},
	}

	runTestCases.withExport<HookCase>({
		testCases,
		hooks: markingHooks,
		act: async ({ source, testCase }) => {
			const committed = source.transaction(async (tx) => {
				await testCase.write(tx)
			})
			await expect(committed).resolves.toBeUndefined()
			return {}
		},
	})
})
