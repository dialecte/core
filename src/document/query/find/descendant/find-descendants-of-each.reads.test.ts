import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Document } from '@/document'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** Root > A > 10 AA_1 (`aa-<i>`) > 10 AAA_1 each (`aaa-<i>-<j>`) > 2 AAAA_1 each, beside B > BB_1 > BBB_1. */
// dialecte-allow fixture-builder: 311 records under A cannot be written inline, and the read budget is measured on that many
function forestXml(): string {
	let branches = ''
	for (let first = 0; first < 10; first++) {
		let middles = ''
		for (let second = 0; second < 10; second++) {
			let leaves = ''
			for (let third = 0; third < 2; third++) {
				leaves += `<AAAA_1 ${customId}="leaf-${first}-${second}-${third}" aAAAA_1="v" />`
			}
			middles += `<AAA_1 ${customId}="aaa-${first}-${second}" aAAA_1="v">${leaves}</AAA_1>`
		}
		branches += `<AA_1 ${customId}="aa-${first}" aAA_1="v">${middles}</AA_1>`
	}
	return /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="v">${branches}</A>
			<B ${customId}="b1" aB="v">
				<BB_1 ${customId}="bb1" aBB_1="v">
					<BBB_1 ${customId}="bbb1" aBBB_1="v" />
				</BB_1>
			</B>
		</Root>
	`
}

const tenAa = Array.from({ length: 10 }, (_, first) => ({ tagName: 'AA_1', id: `aa-${first}` }))
const hundredAaa = Array.from({ length: 100 }, (_, index) => ({
	tagName: 'AAA_1',
	id: `aaa-${Math.floor(index / 10)}-${index % 10}`,
}))

/** The store reads of one collect, as dev perf tallies them. */
type Reads = {
	getMany: number
	records: number
	get: number
	byTag: number
	document: number
	count: number
}

function readsOf(params: { document: Document<TestDialecteConfig> }): Reads {
	const report = params.document.perf.report()
	function countOf(name: string): number {
		return report[`core::store::${name}`]?.count ?? 0
	}
	return {
		getMany: countOf('getMany'),
		records: countOf('records.getMany'),
		get: countOf('get'),
		byTag: countOf('getByTagName'),
		document: countOf('getByDocumentId'),
		count: countOf('count'),
	}
}

const noOtherRead = { get: 0, byTag: 0, document: 0, count: 0 }

/** How many records one collect finds and the store reads it issues. */
async function collectAndCount(params: {
	document: Document<TestDialecteConfig>
	testCase: { inputs: { tagName: string; id: string }[]; collect: string; single?: boolean }
}): Promise<{ found: number; reads: Reads }> {
	const { document, testCase } = params
	document.perf.reset()
	const options = { collect: testCase.collect } as never
	const results = (
		testCase.single
			? [await document.query.findDescendants(testCase.inputs[0] as never, options)]
			: await document.query.findDescendantsOfEach(testCase.inputs as never, options)
	) as Record<string, unknown[]>[]
	const found = results.reduce((total, groups) => total + groups[testCase.collect].length, 0)
	return { found, reads: readsOf({ document }) }
}

/**
 * A flat collect under scopes that are not the document root reads top-down: the scopes in one store read, then one
 * read per level over every scope's frontier, only the children that can hold a collected tag. No tag read, no
 * climb, no whole-document read.
 */
describe('findDescendantsOfEach - store reads', () => {
	type TestCase = BaseXmlTestCase & {
		inputs: { tagName: string; id: string }[]
		collect: string
		/** Read through `findDescendants` with the one input instead. */
		single?: boolean
		expected: { found: number; reads: Reads }
	}

	const testCases: TestCases<TestCase> = {
		'ten scopes in one call → the scopes in one read, then one read per level, each record once': {
			sourceXml: forestXml(),
			inputs: tenAa,
			collect: 'AAAA_1',
			expected: {
				found: 200,
				reads: { getMany: 3, records: 10 + 100 + 200, ...noOtherRead },
			},
		},
		'a hundred scopes in one call → still one read per level': {
			sourceXml: forestXml(),
			inputs: hundredAaa,
			collect: 'AAAA_1',
			expected: { found: 200, reads: { getMany: 2, records: 100 + 200, ...noOtherRead } },
		},
		'a collected tag whose descendants cannot hold it → nothing below it read': {
			sourceXml: forestXml(),
			inputs: [{ tagName: 'A', id: 'a1' }],
			collect: 'AAA_1',
			expected: { found: 100, reads: { getMany: 3, records: 1 + 10 + 100, ...noOtherRead } },
		},
		'a sibling branch that cannot hold the collected tag → never read': {
			sourceXml: forestXml(),
			inputs: [{ tagName: 'A', id: 'a1' }],
			collect: 'AA_1',
			expected: { found: 10, reads: { getMany: 2, records: 1 + 10, ...noOtherRead } },
		},
		'findDescendants under a non-root scope → the same walk, one read per level': {
			sourceXml: forestXml(),
			inputs: [{ tagName: 'A', id: 'a1' }],
			collect: 'AAAA_1',
			single: true,
			expected: {
				found: 200,
				reads: { getMany: 4, records: 1 + 10 + 100 + 200, ...noOtherRead },
			},
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		await expect(collectAndCount({ document: source, testCase })).resolves.toEqual(
			testCase.expected,
		)
	}

	runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
})
