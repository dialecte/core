import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'

import type { AnyRef } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const id = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

/**
 * p1 holds k1 (AAA_1 with the leaf kc), m (AAA_2) and s1 (AAA_3); p2 holds k2 (AAA_1, at most one), u and u2 (AAA_2, at
 * most two) and t1 (AAA_3). Under D, x holds y which holds z, three DDD_2 (anyType: any child).
 */
const refusalSource = /* xml */ `
	<Root ${ns}>
		<A ${id}="a" aA="a">
			<AA_1 ${id}="aa1" aAA_1="aa1" />
			<AA_2 ${id}="p1" aAA_2="p1">
				<AAA_1 ${id}="k1" aAAA_1="k1">
					<AAAA_1 ${id}="kc" aAAAA_1="kc" />
				</AAA_1>
				<AAA_2 ${id}="m" aAAA_2="m" />
				<ext:AAA_3 ${id}="s1" ext:aAAA_3="s1" />
			</AA_2>
			<AA_2 ${id}="p2" aAA_2="p2">
				<AAA_1 ${id}="k2" aAAA_1="k2" />
				<AAA_2 ${id}="u" aAAA_2="u" />
				<AAA_2 ${id}="u2" aAAA_2="u2" />
				<ext:AAA_3 ${id}="t1" ext:aAAA_3="t1" />
			</AA_2>
		</A>
		<D ${id}="d" aD="d">
			<DD_2 ${id}="dd" aDD_2="dd">
				<DDD_2 ${id}="x">
					<DDD_2 ${id}="y">
						<DDD_2 ${id}="z" />
					</DDD_2>
				</DDD_2>
			</DD_2>
		</D>
	</Root>
`

const ref = {
	root: { tagName: 'Root' },
	a: { tagName: 'A', id: 'a' },
	p1: { tagName: 'AA_2', id: 'p1' },
	p2: { tagName: 'AA_2', id: 'p2' },
	k1: { tagName: 'AAA_1', id: 'k1' },
	m: { tagName: 'AAA_2', id: 'm' },
	u: { tagName: 'AAA_2', id: 'u' },
	u2: { tagName: 'AAA_2', id: 'u2' },
	s1: { tagName: 'AAA_3', id: 's1' },
	t1: { tagName: 'AAA_3', id: 't1' },
	kc: { tagName: 'AAAA_1', id: 'kc' },
	dd: { tagName: 'DD_2', id: 'dd' },
	x: { tagName: 'DDD_2', id: 'x' },
	y: { tagName: 'DDD_2', id: 'y' },
	z: { tagName: 'DDD_2', id: 'z' },
} as const satisfies Record<string, AnyRef>

type Source = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
type Tx = Parameters<Parameters<Source['transaction']>[0]>[0]
type Placement = { moved: AnyRef; parent: AnyRef; before?: AnyRef }
type MoveCall = (params: { tx: Tx; placement: Placement }) => Promise<unknown>

type RefusedCase = BaseXmlTestCase & Placement & { expectedKey: string }
type CrossedCase = BaseXmlTestCase & Placement & { expectedStaged: number }

/** The same placement through the typed verb and through the untyped mirror. */
const moveCalls: Record<string, MoveCall> = {
	'tx.move': ({ tx, placement }) =>
		tx.move(placement.moved as never, {
			parent: placement.parent as never,
			before: placement.before as never,
		}),
	'tx.any.move': ({ tx, placement }) =>
		tx.any.move(placement.moved, { parent: placement.parent, before: placement.before }),
}

/**
 * Run a refused move inside a transaction after the writes of `before`: catch it there and read its key and the
 * operations staged once the writes were done and once the move was refused; asserted after the transaction.
 */
async function captureRefusal(params: {
	source: Source
	before?: (tx: Tx) => Promise<unknown>
	move: (tx: Tx) => Promise<unknown>
}): Promise<{ key?: string; stagedBefore: number; stagedAfter: number }> {
	let refusal = { key: undefined as string | undefined, stagedBefore: -1, stagedAfter: -1 }
	await params.source.transaction(async (tx) => {
		await params.before?.(tx)
		const stagedBefore = tx.getStagedOperations().length
		const thrown = await params.move(tx).catch((error: unknown) => error)
		const key = toDialecteError(thrown)?.key
		refusal = { key, stagedBefore, stagedAfter: tx.getStagedOperations().length }
	})
	return refusal
}

const refusedCases: TestCases<RefusedCase> = {
	'the root → PROTECTED_ROOT': {
		sourceXml: refusalSource,
		moved: ref.root,
		parent: ref.a,
		expectedKey: 'PROTECTED_ROOT',
		expectedQueries: ['/default:Root/default:A[@aA="a"]'],
	},
	'a moved record unknown → ELEMENT_NOT_FOUND': {
		sourceXml: refusalSource,
		moved: { tagName: 'AAA_3', id: 'unknown' },
		parent: ref.p2,
		expectedKey: 'ELEMENT_NOT_FOUND',
		expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="t1"]'],
	},
	'a new parent unknown → ELEMENT_NOT_FOUND': {
		sourceXml: refusalSource,
		moved: ref.s1,
		parent: { tagName: 'AA_2', id: 'unknown' },
		expectedKey: 'ELEMENT_NOT_FOUND',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
	},
	'a parent whose definition does not hold the moved tag → INVALID_PARENT_CHILD': {
		sourceXml: refusalSource,
		moved: ref.s1,
		parent: ref.a,
		expectedKey: 'INVALID_PARENT_CHILD',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		unexpectedQueries: ['//default:A/ext:AAA_3'],
	},
	'a parent whose definition holds no child → INVALID_PARENT_CHILD': {
		sourceXml: refusalSource,
		moved: ref.s1,
		parent: ref.kc,
		expectedKey: 'INVALID_PARENT_CHILD',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		unexpectedQueries: ['//default:AAAA_1/ext:AAA_3'],
	},
	'a parent already holding its one AAA_1 → MAX_OCCURRENCES_REACHED': {
		sourceXml: refusalSource,
		moved: ref.k1,
		parent: ref.p2,
		expectedKey: 'MAX_OCCURRENCES_REACHED',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_1[@aAAA_1="k1"]'],
		unexpectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_1[@aAAA_1="k1"]'],
	},
	'a parent already holding its two AAA_2 → MAX_OCCURRENCES_REACHED': {
		sourceXml: refusalSource,
		moved: ref.m,
		parent: ref.p2,
		expectedKey: 'MAX_OCCURRENCES_REACHED',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_2[@aAAA_2="m"]'],
	},
	'the moved record itself as the new parent → MOVE_INTO_OWN_SUBTREE': {
		sourceXml: refusalSource,
		moved: ref.x,
		parent: ref.x,
		expectedKey: 'MOVE_INTO_OWN_SUBTREE',
		expectedQueries: ['//default:DD_2/default:DDD_2/default:DDD_2/default:DDD_2'],
	},
	'a grandchild of the moved record as the new parent → MOVE_INTO_OWN_SUBTREE': {
		sourceXml: refusalSource,
		moved: ref.x,
		parent: ref.z,
		expectedKey: 'MOVE_INTO_OWN_SUBTREE',
		expectedQueries: ['//default:DD_2/default:DDD_2/default:DDD_2/default:DDD_2'],
	},
	'a descendant three levels down, of another tag than the moved one → MOVE_INTO_OWN_SUBTREE': {
		sourceXml: refusalSource,
		moved: ref.dd,
		parent: ref.z,
		expectedKey: 'MOVE_INTO_OWN_SUBTREE',
		expectedQueries: ['/default:Root/default:D/default:DD_2[@aDD_2="dd"]'],
	},
	'before a child of another parent → MOVE_BEFORE_NOT_SIBLING': {
		sourceXml: refusalSource,
		moved: ref.m,
		parent: ref.p1,
		before: ref.u,
		expectedKey: 'MOVE_BEFORE_NOT_SIBLING',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_2[@aAAA_2="m"]'],
	},
	'before a ref naming an AAA_3 sibling under another tag → MOVE_BEFORE_NOT_SIBLING': {
		sourceXml: refusalSource,
		moved: ref.s1,
		parent: ref.p2,
		before: { tagName: 'AAA_2', id: 't1' },
		expectedKey: 'MOVE_BEFORE_NOT_SIBLING',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		unexpectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
	},
	'p2 at its one AAA_1 and before u of another tag → MAX_OCCURRENCES_REACHED, the parent judged first':
		{
			sourceXml: refusalSource,
			moved: ref.k1,
			parent: ref.p2,
			before: ref.u,
			expectedKey: 'MAX_OCCURRENCES_REACHED',
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/default:AAA_1[@aAAA_1="k1"]'],
		},
	'before a child of the new parent with another tag → MOVE_BEFORE_NOT_SIBLING': {
		sourceXml: refusalSource,
		moved: ref.s1,
		parent: ref.p2,
		before: ref.u,
		expectedKey: 'MOVE_BEFORE_NOT_SIBLING',
		expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		unexpectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
	},
}

for (const [verb, move] of Object.entries(moveCalls)) {
	describe(`${verb} - a refused move stages nothing`, () => {
		runTestCases.withExport<RefusedCase>({
			testCases: refusedCases,
			act: async ({ source, testCase }) => {
				const refusal = await captureRefusal({
					source,
					move: (tx) => move({ tx, placement: testCase }),
				})
				expect(refusal).toEqual({ key: testCase.expectedKey, stagedBefore: 0, stagedAfter: 0 })
				return {}
			},
		})
	})
}

type DeletedCase = RefusedCase & { deleted: AnyRef }

describe('tx.move - a record deleted earlier in the transaction', () => {
	const testCases: TestCases<DeletedCase> = {
		'the moved record deleted earlier → ELEMENT_NOT_FOUND': {
			sourceXml: refusalSource,
			deleted: ref.s1,
			moved: ref.s1,
			parent: ref.p2,
			expectedKey: 'ELEMENT_NOT_FOUND',
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="t1"]'],
			unexpectedQueries: ['//ext:AAA_3[@ext:aAAA_3="s1"]'],
		},
		'the new parent deleted earlier → ELEMENT_NOT_FOUND': {
			sourceXml: refusalSource,
			deleted: ref.p2,
			moved: ref.s1,
			parent: ref.p2,
			expectedKey: 'ELEMENT_NOT_FOUND',
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
			unexpectedQueries: ['//default:AA_2[@aAA_2="p2"]'],
		},
	}

	runTestCases.withExport<DeletedCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				before: (tx) => tx.any.delete(testCase.deleted),
				move: (tx) => moveCalls['tx.move']({ tx, placement: testCase }),
			})
			expect(refusal.key).toBe(testCase.expectedKey)
			expect(refusal.stagedAfter).toBe(refusal.stagedBefore)
			return {}
		},
	})
})

describe('tx.move - the limits a move does not cross', () => {
	const testCases: TestCases<CrossedCase> = {
		'a reorder under p2 holding its two AAA_2, the most it may → not refused, the moved one not counted twice':
			{
				sourceXml: refusalSource,
				moved: ref.u2,
				parent: ref.p2,
				before: ref.u,
				expectedStaged: 1,
				expectedQueries: ['//default:AA_2[@aAA_2="p2"]/default:AAA_2[1][@aAAA_2="u2"]'],
			},
		'z moved up to dd, dd reaching its two DDD_2 → not refused, a parent above is no cycle': {
			sourceXml: refusalSource,
			moved: ref.z,
			parent: ref.dd,
			expectedStaged: 3,
			expectedQueries: [
				'//default:DD_2/default:DDD_2[2][not(*)]',
				'//default:DDD_2/default:DDD_2[not(*)]',
			],
		},
		'z moved under x, an ancestor admitting any child → not refused, an ancestor is no cycle': {
			sourceXml: refusalSource,
			moved: ref.z,
			parent: ref.x,
			expectedStaged: 3,
			expectedQueries: [
				'//default:DD_2/default:DDD_2/default:DDD_2[1][not(*)]',
				'//default:DD_2/default:DDD_2/default:DDD_2[2][not(*)]',
			],
		},
	}

	runTestCases.withExport<CrossedCase>({
		testCases,
		act: async ({ source, testCase }) => {
			let staged = 0
			const committed = source.transaction(async (tx) => {
				await moveCalls['tx.move']({ tx, placement: testCase })
				staged = tx.getStagedOperations().length
			})
			await expect(committed).resolves.toBeUndefined()
			expect(staged).toBe(testCase.expectedStaged)
			return {}
		},
	})
})

type TypedCase = BaseXmlTestCase & {
	call: (tx: Tx) => Promise<unknown>
	expected: { key?: string; stagedAfter: number }
}

describe('tx.move - the typed signature', () => {
	const testCases: TestCases<TypedCase> = {
		'an AAA_3 moved under an AA_2, refs typed as written → three updates staged': {
			sourceXml: refusalSource,
			call: (tx) =>
				tx.move({ tagName: 'AAA_3', id: 's1' }, { parent: { tagName: 'AA_2', id: 'p2' } }),
			expected: { stagedAfter: 3 },
			expectedQueries: ['//default:AA_2[@aAA_2="p2"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		},
		'an AAA_3 moved under an A, refused by the type → INVALID_PARENT_CHILD at run time': {
			sourceXml: refusalSource,
			call: (tx) =>
				// @ts-expect-error an A holds no AAA_3: the type refuses it, the run-time guard covers untyped callers
				tx.move({ tagName: 'AAA_3', id: 's1' }, { parent: { tagName: 'A', id: 'a' } }),
			expected: { key: 'INVALID_PARENT_CHILD', stagedAfter: 0 },
			expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
		},
		'before an AAA_2 for a moved AAA_3, refused by the type → MOVE_BEFORE_NOT_SIBLING at run time':
			{
				sourceXml: refusalSource,
				call: (tx) =>
					tx.move(
						{ tagName: 'AAA_3', id: 's1' },
						// @ts-expect-error before must name a sibling of the moved tag: the run-time guard covers untyped callers
						{ parent: { tagName: 'AA_2', id: 'p2' }, before: { tagName: 'AAA_2', id: 'u' } },
					),
				expected: { key: 'MOVE_BEFORE_NOT_SIBLING', stagedAfter: 0 },
				expectedQueries: ['//default:AA_2[@aAA_2="p1"]/ext:AAA_3[@ext:aAAA_3="s1"]'],
			},
	}

	runTestCases.withExport<TypedCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const { key, stagedAfter } = await captureRefusal({ source, move: testCase.call })
			expect({ key, stagedAfter }).toEqual({ key: undefined, ...testCase.expected })
			return {}
		},
	})
})
