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
import type { AnyRawRecord } from '@/types'

const id = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

/**
 * Two AA_2 parents. p1 holds k1 (AAA_1 with kc), m (AAA_2 with mc and mc2) and s1 (AAA_3). p2 holds k2 (AAA_1), t1 and
 * t2 (AAA_3), then u (AAA_2): an AAA_3 placed after the last AAA_3 of p2 lands before u, not at the end.
 */
const twoParents = /* xml */ `
	<Root ${ns}>
		<A ${id}="a" aA="a">
			<AA_1 ${id}="aa1" aAA_1="aa1" />
			<AA_2 ${id}="p1" aAA_2="p1">
				<AAA_1 ${id}="k1" aAAA_1="k1">
					<AAAA_1 ${id}="kc" aAAAA_1="kc" />
				</AAA_1>
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

/** One AA_2 holding three AAA_3, the most it may hold: x1, x2, x3. */
const threeSiblings = /* xml */ `
	<Root ${ns}>
		<A ${id}="a" aA="a">
			<AA_1 ${id}="aa1" aAA_1="aa1" />
			<AA_2 ${id}="p1" aAA_2="p1">
				<ext:AAA_3 ${id}="x1" ext:aAAA_3="x1" />
				<ext:AAA_3 ${id}="x2" ext:aAAA_3="x2" />
				<ext:AAA_3 ${id}="x3" ext:aAAA_3="x3" />
			</AA_2>
		</A>
	</Root>
`

/** One AA_2 whose children mix tags: x1 (AAA_3), b (AAA_2), x2 (AAA_3). */
const mixedTags = /* xml */ `
	<Root ${ns}>
		<A ${id}="a" aA="a">
			<AA_1 ${id}="aa1" aAA_1="aa1" />
			<AA_2 ${id}="p1" aAA_2="p1">
				<ext:AAA_3 ${id}="x1" ext:aAAA_3="x1" />
				<AAA_2 ${id}="b" aAAA_2="b" />
				<ext:AAA_3 ${id}="x2" ext:aAAA_3="x2" />
			</AA_2>
		</A>
	</Root>
`

const ref = {
	p1: { tagName: 'AA_2', id: 'p1' },
	p2: { tagName: 'AA_2', id: 'p2' },
	k1: { tagName: 'AAA_1', id: 'k1' },
	m: { tagName: 'AAA_2', id: 'm' },
	u: { tagName: 'AAA_2', id: 'u' },
	s1: { tagName: 'AAA_3', id: 's1' },
	t1: { tagName: 'AAA_3', id: 't1' },
	t2: { tagName: 'AAA_3', id: 't2' },
	x1: { tagName: 'AAA_3', id: 'x1' },
	x2: { tagName: 'AAA_3', id: 'x2' },
	x3: { tagName: 'AAA_3', id: 'x3' },
	mc: { tagName: 'AAAA_1', id: 'mc' },
	mc2: { tagName: 'AAAA_2', id: 'mc2' },
} as const satisfies Record<string, AnyRef>

type Tx = Parameters<
	Parameters<ActParams<TestDialecteConfig, BaseXmlTestCase>['source']['transaction']>[0]
>[0]

/** A record as the move leaves it: its parent's id and its children's ids, in order. */
type Placement = { parent: string | undefined; children: string[] }

type MoveCase = BaseXmlTestCase & {
	moved: AnyRef
	parent: AnyRef
	before?: AnyRef
	/** The records read after the commit, each with its expected parent and children. */
	expected: Record<string, Placement>
	/** The ids of the records the move staged as updated, sorted. */
	expectedStaged: string[]
}

/** Each record of the case read after the commit, by id. */
async function placementsOf(params: {
	source: ActParams<TestDialecteConfig, MoveCase>['source']
	refs: AnyRef[]
}): Promise<Record<string, Placement>> {
	const records = await params.source.query.any.getRecords(params.refs)
	return Object.fromEntries(
		records.map((record, index) => [
			params.refs[index].id,
			{ parent: record?.parent?.id, children: record?.children.map((child) => child.id) ?? [] },
		]),
	)
}

/** The typed verb, called with the case's refs (a table mixes tags no single generic call names). */
function moveOf(params: { tx: Tx; testCase: MoveCase }): Promise<AnyRawRecord> {
	const { tx, testCase } = params
	return tx.move(testCase.moved as never, {
		parent: testCase.parent as never,
		before: testCase.before as never,
	})
}

describe('tx.move - re-parent an element, record ids kept', () => {
	const testCases: TestCases<MoveCase> = {
		'a leaf moved under another parent → its parent and both parents children updated, id kept': {
			sourceXml: twoParents,
			moved: ref.s1,
			parent: ref.p2,
			expected: {
				s1: { parent: 'p2', children: [] },
				p1: { parent: 'a', children: ['k1', 'm'] },
				p2: { parent: 'a', children: ['k2', 't1', 't2', 's1', 'u'] },
			},
			expectedStaged: ['p1', 'p2', 's1'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3'],
		},
		'a subtree moved → descendants keep their parent ids and are found under the new parent': {
			sourceXml: twoParents,
			moved: ref.m,
			parent: ref.p2,
			expected: {
				m: { parent: 'p2', children: ['mc', 'mc2'] },
				mc: { parent: 'm', children: [] },
				mc2: { parent: 'm', children: [] },
				p1: { parent: 'a', children: ['k1', 's1'] },
				p2: { parent: 'a', children: ['k2', 't1', 't2', 'u', 'm'] },
			},
			expectedStaged: ['m', 'p1', 'p2'],
			expectedQueries: [
				'//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"]/default:AAAA_1[@aAAAA_1="mc"]',
				'//default:AA_2[@aAA_2="p2"]/default:AAA_2[@aAAA_2="m"]/default:AAAA_2[@aAAAA_2="mc2"]',
			],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_2'],
		},
		'before the first same-tag sibling → placed before it': {
			sourceXml: twoParents,
			moved: ref.s1,
			parent: ref.p2,
			before: ref.t1,
			expected: { p2: { parent: 'a', children: ['k2', 's1', 't1', 't2', 'u'] } },
			expectedStaged: ['p1', 'p2', 's1'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[1][@ext:aAAA_3="s1"]'],
		},
		'before a same-tag sibling in the middle → placed before it': {
			sourceXml: twoParents,
			moved: ref.s1,
			parent: ref.p2,
			before: ref.t2,
			expected: { p2: { parent: 'a', children: ['k2', 't1', 's1', 't2', 'u'] } },
			expectedStaged: ['p1', 'p2', 's1'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[2][@ext:aAAA_3="s1"]'],
		},
		'before omitted, no same-tag sibling → appended after the other children': {
			sourceXml: twoParents,
			moved: ref.mc2,
			parent: ref.k1,
			expected: {
				k1: { parent: 'p1', children: ['kc', 'mc2'] },
				m: { parent: 'p1', children: ['mc'] },
				mc2: { parent: 'k1', children: [] },
			},
			expectedStaged: ['k1', 'm', 'mc2'],
			expectedQueries: ['//default:AAA_1[@aAAA_1="k1"]/default:AAAA_2[@aAAAA_2="mc2"]'],
		},
		'same parent with before → one parent update (a reorder)': {
			sourceXml: twoParents,
			moved: ref.t2,
			parent: ref.p2,
			before: ref.t1,
			expected: {
				t2: { parent: 'p2', children: [] },
				p2: { parent: 'a', children: ['k2', 't2', 't1', 'u'] },
			},
			expectedStaged: ['p2'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[1][@ext:aAAA_3="t2"]'],
		},
		'same parent without before → after the last same-tag sibling, one parent update': {
			sourceXml: twoParents,
			moved: ref.t1,
			parent: ref.p2,
			expected: {
				t1: { parent: 'p2', children: [] },
				p2: { parent: 'a', children: ['k2', 't2', 't1', 'u'] },
			},
			expectedStaged: ['p2'],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[2][@ext:aAAA_3="t1"]'],
		},
		'a forward reorder before a later same-tag sibling → placed right before it': {
			sourceXml: threeSiblings,
			moved: ref.x1,
			parent: ref.p1,
			before: ref.x3,
			expected: { p1: { parent: 'a', children: ['x2', 'x1', 'x3'] } },
			expectedStaged: ['p1'],
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[2][@ext:aAAA_3="x1"]'],
		},
		'before the moved record itself → the same place, nothing staged': {
			sourceXml: twoParents,
			moved: ref.t1,
			parent: ref.p2,
			before: ref.t1,
			expected: { p2: { parent: 'a', children: ['k2', 't1', 't2', 'u'] } },
			expectedStaged: [],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[1][@ext:aAAA_3="t1"]'],
		},
		'the last AAA_3, a child of another tag after the first, moved without before → nothing staged':
			{
				sourceXml: mixedTags,
				moved: ref.x2,
				parent: ref.p1,
				expected: { p1: { parent: 'a', children: ['x1', 'b', 'x2'] } },
				expectedStaged: [],
				expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[2][@ext:aAAA_3="x2"]'],
			},
		'before the next AAA_3, a child of another tag between them → nothing staged': {
			sourceXml: mixedTags,
			moved: ref.x1,
			parent: ref.p1,
			before: ref.x2,
			expected: { p1: { parent: 'a', children: ['x1', 'b', 'x2'] } },
			expectedStaged: [],
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[1][@ext:aAAA_3="x1"]'],
		},
		'a move before the sibling it already precedes → nothing staged': {
			sourceXml: twoParents,
			moved: ref.t1,
			parent: ref.p2,
			before: ref.t2,
			expected: { p2: { parent: 'a', children: ['k2', 't1', 't2', 'u'] } },
			expectedStaged: [],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[1][@ext:aAAA_3="t1"]'],
		},
		'the last same-tag sibling moved without before to its own parent → nothing staged': {
			sourceXml: twoParents,
			moved: ref.t2,
			parent: ref.p2,
			expected: { p2: { parent: 'a', children: ['k2', 't1', 't2', 'u'] } },
			expectedStaged: [],
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[2][@ext:aAAA_3="t2"]'],
		},
	}

	runTestCases.withExport<MoveCase>({
		testCases,
		act: async ({ source, testCase }) => {
			let moved: AnyRawRecord | undefined
			let staged: string[] = []
			const committed = source.transaction(async (tx) => {
				moved = await moveOf({ tx, testCase })
				staged = tx
					.getStagedOperations()
					.map((operation) => `${operation.status}:${operation.newRecord?.id}`)
			})
			await expect(committed).resolves.toBeUndefined()
			const refs = Object.keys(testCase.expected).map((key) => ref[key as keyof typeof ref])
			const returned = { id: moved?.id, tagName: moved?.tagName, parent: moved?.parent?.id }
			expect(returned).toEqual({ ...testCase.moved, parent: testCase.parent.id })
			expect(staged.sort()).toEqual(testCase.expectedStaged.map((staged) => `updated:${staged}`))
			const placements = await placementsOf({ source, refs })
			expect(placements).toEqual(testCase.expected)
			return {}
		},
	})
})
