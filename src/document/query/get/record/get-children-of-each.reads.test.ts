import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRecord,
	createTestRunner,
	runTestCases,
} from '@/test'

import type { AnyRefOrRecord, Document } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** AA_1 is transparent: its children are looked up from its parent when the parent has none of the tag. */
const TRANSPARENT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	transparentElements: ['AA_1'] as const,
} as unknown as TestDialecteConfig

const transparentRunner = createTestRunner({ dialecteConfig: TRANSPARENT_CONFIG })

const xml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="w1" aAA_1="v">
				<AAA_1 ${customId}="x1" aAAA_1="v" />
				<AAA_1 ${customId}="x2" aAAA_1="v" />
			</AA_1>
			<AA_2 ${customId}="aa2" aAA_2="v" />
		</A>
		<A ${customId}="a2" aA="v">
			<AA_1 ${customId}="w2" aAA_1="v">
				<AAA_1 ${customId}="x3" aAAA_1="v" />
			</AA_1>
		</A>
		<A ${customId}="a3" aA="v" />
	</Root>
`

const a1 = { tagName: 'A', id: 'a1' } as const
const a2 = { tagName: 'A', id: 'a2' } as const
const a3 = { tagName: 'A', id: 'a3' } as const

/** An A the store does not hold, naming the stored w1 and w2 as its children: answered from its own `children`. */
const givenWithTwoWrappers = createTestRecord({
	type: 'tracked',
	record: {
		tagName: 'A',
		id: 'given',
		children: [
			{ tagName: 'AA_1', id: 'w1' },
			{ tagName: 'AA_1', id: 'w2' },
		],
	},
})

/** Root > 1,000 A > one transparent AA_1 each > one AAA_1 each. */
// dialecte-allow fixture-builder: 1,000 parents cannot be written inline, and the read budget is measured on that many
function thousandWrappedParentsXml(): string {
	let parents = ''
	for (let index = 0; index < 1000; index++) {
		parents += `<A ${customId}="p-${index}" aA="v"><AA_1 ${customId}="w-${index}" aAA_1="v"><AAA_1 ${customId}="c-${index}" aAAA_1="v" /></AA_1></A>`
	}
	return `<Root ${ns}>${parents}</Root>`
}

const thousandParents: AnyRefOrRecord[] = Array.from({ length: 1000 }, function parent(_, index) {
	return { tagName: 'A', id: `p-${index}` }
})

type TestCase = BaseXmlTestCase & {
	inputs: AnyRefOrRecord[]
	tagName: string
	expected: { reads: number; records: number }
}

function countOf(params: { document: Document<TestDialecteConfig>; name: string }): number {
	return params.document.perf.report()[params.name]?.count ?? 0
}

async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
	source.perf.reset()
	await source.query.any.getChildrenOfEach(testCase.inputs, { tagName: testCase.tagName })

	expect({
		reads: countOf({ document: source, name: 'core::store::getMany' }),
		records: countOf({ document: source, name: 'core::store::records.getMany' }),
	}).toEqual(testCase.expected)
}

describe('getChildrenOfEach - store reads', () => {
	describe('direct children: one read for the parents, one for all their children', () => {
		const testCases: TestCases<TestCase> = {
			'three refs → two reads, the parents and their children each once': {
				sourceXml: xml,
				inputs: [a1, a2, a3],
				tagName: 'AA_1',
				expected: { reads: 2, records: 3 + 2 },
			},
			'a record given → one read, its children only': {
				sourceXml: xml,
				inputs: [givenWithTwoWrappers],
				tagName: 'AA_1',
				expected: { reads: 1, records: 2 },
			},
			'parents with no child of the tag → one read, the parents only': {
				sourceXml: xml,
				inputs: [a2, a3],
				tagName: 'AA_2',
				expected: { reads: 1, records: 2 },
			},
			'the same parent three times → it and its children read once': {
				sourceXml: xml,
				inputs: [a1, a1, a1],
				tagName: 'AA_1',
				expected: { reads: 2, records: 2 },
			},
		}

		runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
	})

	describe('through transparent elements: at most three reads', () => {
		const testCases: TestCases<TestCase> = {
			'three refs → the parents, their wrappers, the children inside, each once': {
				sourceXml: xml,
				inputs: [a1, a2, a3],
				tagName: 'AAA_1',
				expected: { reads: 3, records: 3 + 2 + 3 },
			},
			'a wrapper given beside its parent → read once, its children once': {
				sourceXml: xml,
				inputs: [{ tagName: 'AA_1', id: 'w1' }, a1],
				tagName: 'AAA_1',
				expected: { reads: 2, records: 2 + 2 },
			},
			'1,000 parents through their wrappers → three reads, each record once': {
				sourceXml: thousandWrappedParentsXml(),
				inputs: thousandParents,
				tagName: 'AAA_1',
				expected: { reads: 3, records: 3000 },
			},
		}

		transparentRunner.withoutExport({ testCases, act, dev: { perf: true } })
	})
})
