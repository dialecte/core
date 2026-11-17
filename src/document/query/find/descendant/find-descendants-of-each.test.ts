import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Collect, FindDescendantsParams } from './find-descendant.types'
import type { Document, Query, RefOrRecord } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

type Input = RefOrRecord<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
type Options = FindDescendantsParams<
	TestDialecteConfig,
	ElementsOf<TestDialecteConfig>,
	Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
>

// The AAAA_1 leaves come in document order aaaa5, aaaa3, aaaa4: an answer in id order is not the walk's order.
const xml = /* xml */ `
	<Root ${ns} ${customId}="root">
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa5" aAAAA_1="v" />
					<AAAA_2 ${customId}="aaaa2" aAAAA_2="1" />
				</AAA_1>
				<AAA_2 ${customId}="aaa2" aAAA_2="v">
					<AAAA_1 ${customId}="aaaa3" aAAAA_1="x" />
				</AAA_2>
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="skip">
				<AAA_1 ${customId}="aaa3" aAAA_1="v">
					<AAAA_1 ${customId}="aaaa4" aAAAA_1="v" />
				</AAA_1>
			</AA_2>
		</A>
		<B ${customId}="b1" aB="v">
			<BB_1 ${customId}="bb1" aBB_1="v">
				<BBB_1 ${customId}="bbb1" aBBB_1="v" />
			</BB_1>
		</B>
	</Root>
`

const root = { tagName: 'Root', id: 'root' } as const
const a1 = { tagName: 'A', id: 'a1' } as const
const aa1 = { tagName: 'AA_1', id: 'aa1' } as const
const aa2 = { tagName: 'AA_2', id: 'aa2' } as const
const b1 = { tagName: 'B', id: 'b1' } as const

/** Each position's answer as ids by tag name. */
type Answer = Record<string, string[]>

function idsOf(params: { results: Record<string, { id: string }[]>[]; sorted: boolean }): Answer[] {
	return params.results.map(function answerOf(groups) {
		return Object.fromEntries(
			Object.entries(groups).map(function idsOfGroup([tagName, records]) {
				const ids = records.map(({ id }) => id)
				return [tagName, params.sorted ? [...ids].sort() : ids]
			}),
		)
	})
}

/**
 * Each position's answer as ids by tag name, and the ids answered at two positions by the same object (a record
 * answered at two positions is a copy at the second, never the same object).
 */
async function answersOf(params: {
	query: Query<TestDialecteConfig>
	inputs: Input[]
	options: Options
	sorted: boolean
}): Promise<{ answers: Answer[]; shared: string[] }> {
	const results = (await params.query.findDescendantsOfEach(
		params.inputs,
		params.options,
	)) as Record<string, { id: string }[]>[]
	const seen = new Set<object>()
	const shared: string[] = []
	for (const record of results.flatMap((groups) => Object.values(groups).flat())) {
		if (seen.has(record)) shared.push(record.id)
		seen.add(record)
	}
	return { answers: idsOf({ results, sorted: params.sorted }), shared }
}

/** aa1's AAA_2 through a record of aa1 read before `added` was committed under it, and through its ref. */
async function staleAndFresh(params: {
	document: Document<TestDialecteConfig>
	added: {
		tagName: 'AAA_2'
		id: `${string}-${string}-${string}-${string}-${string}`
		attributes: { aAAA_2: string }
	}
}): Promise<string[][]> {
	const { document, added } = params
	const stale = await document.query.getRecord(aa1)
	await document.transaction(async function addUnderAa1(tx) {
		await tx.addChild(aa1, added)
	})
	const results = (await document.query.findDescendantsOfEach([stale as Input, aa1], {
		collect: 'AAA_2',
	} as Options)) as Record<string, { id: string }[]>[]
	return results.map((groups) => groups.AAA_2.map(({ id }) => id))
}

/** `query.any`'s answer per position, its non-empty groups only, and the ids answered at two positions by one object. */
async function anyAnswersOf(params: {
	document: Document<TestDialecteConfig>
	inputs: Input[]
}): Promise<{ answers: Answer[]; shared: string[] }> {
	const results = await params.document.query.any.findDescendantsOfEach(params.inputs)
	const nonEmpty = results.map((groups) =>
		Object.fromEntries(Object.entries(groups).filter(([, records]) => records.length > 0)),
	)
	const seen = new Set<object>()
	const shared: string[] = []
	for (const record of nonEmpty.flatMap((groups) => Object.values(groups).flat())) {
		if (seen.has(record)) shared.push(record.id)
		seen.add(record)
	}
	return { answers: idsOf({ results: nonEmpty, sorted: false }), shared }
}

describe('findDescendantsOfEach - answers', () => {
	describe('each position answers what findDescendants answers for it', () => {
		type TestCase = BaseXmlTestCase & {
			inputs: Input[]
			options: Options
			expected: Answer[]
			/** The store's or the path walk's own order: compared as sets (a non-root flat collect answers in id order). */
			anyOrder?: boolean
		}

		const testCases: TestCases<TestCase> = {
			'two scopes, two tags → each scope its own subtree, each tag in id order': {
				sourceXml: xml,
				inputs: [a1, b1],
				options: { collect: ['AAAA_1', 'BBB_1'] },
				expected: [
					{ AAAA_1: ['aaaa3', 'aaaa4', 'aaaa5'], BBB_1: [] },
					{ AAAA_1: [], BBB_1: ['bbb1'] },
				],
			},
			'an array entry with where → only the matching records': {
				sourceXml: xml,
				inputs: [a1],
				options: { collect: [{ AAAA_1: { where: { aAAAA_1: 'v' } } }] },
				expected: [{ AAAA_1: ['aaaa4', 'aaaa5'] }],
			},
			'nested scopes, the inner one first → a record under both counts for both': {
				sourceXml: xml,
				inputs: [aa1, a1],
				options: { collect: 'AAAA_1' },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }, { AAAA_1: ['aaaa3', 'aaaa4', 'aaaa5'] }],
			},
			'the same scope twice → answered at each position': {
				sourceXml: xml,
				inputs: [aa1, aa1],
				options: { collect: 'AAAA_1' },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }, { AAAA_1: ['aaaa3', 'aaaa5'] }],
			},
			'a ref that names no element → empty groups at its position': {
				sourceXml: xml,
				inputs: [aa1, { tagName: 'AA_1', id: 'missing' }],
				options: { collect: 'AAAA_1' },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }, { AAAA_1: [] }],
			},
			'an unconditionally omitted tag on the way → its branch neither collected nor followed': {
				sourceXml: xml,
				inputs: [a1],
				options: { collect: 'AAAA_1', omit: ['AA_2'] },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }],
			},
			'an omit with where on the way → the matching branch left out': {
				sourceXml: xml,
				inputs: [a1],
				options: { collect: 'AAAA_1', omit: [{ AA_2: { where: { aAA_2: 'skip' } } }] },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }],
			},
			'an omit with where matching an inner scope → left out of the outer scope, its own descendants answered':
				{
					sourceXml: xml,
					inputs: [a1, aa2],
					options: { collect: 'AAAA_1', omit: [{ AA_2: { where: { aAA_2: 'skip' } } }] },
					expected: [{ AAAA_1: ['aaaa3', 'aaaa5'] }, { AAAA_1: ['aaaa4'] }],
				},
			'an omit with where on the collected tag → the matching records left out': {
				sourceXml: xml,
				inputs: [aa1],
				options: { collect: 'AAAA_1', omit: [{ AAAA_1: { where: { aAAAA_1: 'x' } } }] },
				expected: [{ AAAA_1: ['aaaa5'] }],
			},
			"the scope's own tag collected → the scope answered with its descendants": {
				sourceXml: xml,
				inputs: [aa1],
				options: { collect: ['AA_1', 'AAAA_1'] },
				expected: [{ AA_1: ['aa1'], AAAA_1: ['aaaa3', 'aaaa5'] }],
			},
			"the scope's own tag unconditionally omitted → nothing under it, the other scope answered": {
				sourceXml: xml,
				inputs: [aa1, b1],
				options: { collect: ['AAAA_1', 'BBB_1'], omit: ['AA_1'] },
				expected: [
					{ AAAA_1: [], BBB_1: [] },
					{ AAAA_1: [], BBB_1: ['bbb1'] },
				],
			},
			'the document root beside a scope → every record of the tag, and the scope its own': {
				sourceXml: xml,
				inputs: [root, aa1],
				options: { collect: 'AAAA_1' },
				expected: [{ AAAA_1: ['aaaa3', 'aaaa4', 'aaaa5'] }, { AAAA_1: ['aaaa3', 'aaaa5'] }],
				anyOrder: true,
			},
			'a path collect under two scopes → each scope its own path matches': {
				sourceXml: xml,
				inputs: [a1, b1],
				options: { collect: { AA_1: { AAAA_1: true } } },
				expected: [
					{ AA_1: ['aa1'], AAAA_1: ['aaaa3', 'aaaa5'] },
					{ AA_1: [], AAAA_1: [] },
				],
				anyOrder: true,
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			await expect(
				answersOf({
					query: source.query,
					inputs: testCase.inputs,
					options: testCase.options,
					sorted: testCase.anyOrder === true,
				}),
			).resolves.toEqual({ answers: testCase.expected, shared: [] })
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('a record given is used as given', () => {
		type TestCase = BaseXmlTestCase & {
			/** An AAA_2 committed under aa1 after the record of aa1 was read. */
			added: {
				tagName: 'AAA_2'
				id: `${string}-${string}-${string}-${string}-${string}`
				attributes: { aAAA_2: string }
			}
			expected: string[][]
		}

		const testCases: TestCases<TestCase> = {
			'a record read before a child was committed under it, and its ref → the record its own children, the ref the new one too':
				{
					sourceXml: xml,
					added: { tagName: 'AAA_2', id: '0-0-0-0-1', attributes: { aAAA_2: 'v' } },
					expected: [['aaa2'], ['0-0-0-0-1', 'aaa2']],
				},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			await expect(staleAndFresh({ document: source, added: testCase.added })).resolves.toEqual(
				testCase.expected,
			)
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('query.any collects every descendant tag of each element', () => {
		type TestCase = BaseXmlTestCase & {
			inputs: Input[]
			/** Each position's non-empty groups, ids in id order. */
			expected: Answer[]
		}

		const testCases: TestCases<TestCase> = {
			'two tag names, one element given twice → each element its own tags, the repeat answered again':
				{
					sourceXml: xml,
					inputs: [aa1, b1, aa1],
					expected: [
						{ AAA_1: ['aaa1'], AAA_2: ['aaa2'], AAAA_1: ['aaaa3', 'aaaa5'], AAAA_2: ['aaaa2'] },
						{ BB_1: ['bb1'], BBB_1: ['bbb1'] },
						{ AAA_1: ['aaa1'], AAA_2: ['aaa2'], AAAA_1: ['aaaa3', 'aaaa5'], AAAA_2: ['aaaa2'] },
					],
				},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			await expect(anyAnswersOf({ document: source, inputs: testCase.inputs })).resolves.toEqual({
				answers: testCase.expected,
				shared: [],
			})
		}

		runTestCases.withoutExport({ testCases, act })
	})
})
