import { READS_BEFORE_SIZING } from './record-source'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Collect, FindDescendantsParams } from './find-descendant.types'
import type { Document, Query, Ref, Transaction } from '@/document'
import type { ActParams, BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/** The root, then the reads a climb may issue before the document read is due. */
const READS_UP_TO_THE_SWITCH = READS_BEFORE_SIZING + 1

/**
 * `A` holding `width` `AA_1` children, each holding one `AAA_1` (`aa<n>` / `aaa<n>`); every
 * other `AA_1` carries `aAA_1="skip"` (the odd ones `"v"`) so an `omit` with a `where` can
 * halve the collect. Far more candidates than the reads allowed before the document read.
 */
function wideA(width: number): string {
	const blocks = Array.from(
		{ length: width },
		(_, i) => `
				<AA_1 ${customId}="aa${i + 1}" aAA_1="${i % 2 === 0 ? 'v' : 'skip'}">
					<AAA_1 ${customId}="aaa${i + 1}" aAAA_1="v" />
				</AA_1>`,
	).join('')
	return /* xml */ `
		<Root ${ns} ${customId}="root">
			<A ${customId}="a1" aA="v">${blocks}
			</A>
		</Root>
	`
}

/** Four `AAAA_1` leaves three levels under `A`, two under each `AAA_1` (`aaa1` and `aaa2`). */
function deepA(params: { aaa1: 'v' | 'skip' } = { aaa1: 'v' }): string {
	return /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="v">
				<AA_1 ${customId}="aa1" aAA_1="v">
					<AAA_1 ${customId}="aaa1" aAAA_1="${params.aaa1}">
						<AAAA_1 ${customId}="aaaa1" aAAAA_1="v" />
						<AAAA_1 ${customId}="aaaa2" aAAAA_1="v" />
					</AAA_1>
					<AAA_1 ${customId}="aaa2" aAAA_1="v">
						<AAAA_1 ${customId}="aaaa3" aAAAA_1="v" />
						<AAAA_1 ${customId}="aaaa4" aAAAA_1="v" />
					</AAA_1>
				</AA_1>
			</A>
		</Root>
	`
}

/**
 * How many store reads a collect costs. A flat collect under a scope that is not the document root reads
 * top-down, one store read per level (no by-id read, no whole-document read); under the document root it is the
 * tag read alone. A path collect fetches level by level and gives way to ONE whole-document read once that has
 * cost more than the read would. The result is the same either way.
 */
describe('findDescendants - store reads', () => {
	type TestCase = BaseXmlTestCase & {
		ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		options: FindDescendantsParams<
			TestDialecteConfig,
			ElementsOf<TestDialecteConfig>,
			Collect<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		>
		expectedCounts: Partial<Record<ElementsOf<TestDialecteConfig>, number>>
		/** Ids that must be (or must not be) among the collected records. */
		expectedIds?: { present?: string[]; absent?: string[] }
		/** Whole-document reads (`getByDocumentId`) the collect may issue. */
		documentReads: number
		/** Upper bound on the by-id reads (`store.get`) the collect may issue. */
		recordReadsAtMost: number
	}

	const testCases: Record<string, TestCase> = {
		'a flat collect of 300 under a non-root scope → read top-down: no by-id read, no document read':
			{
				sourceXml: wideA(300),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAA_1' },
				expectedCounts: { AAA_1: 300 },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
		'4 candidates three levels under a deep scope → read top-down: no by-id read, no document read':
			{
				sourceXml: deepA(),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAAA_1' },
				expectedCounts: { AAAA_1: 4 },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
		'omit with where on the path, 300 candidates → the walk honours it': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1', omit: [{ AA_1: { where: { aAA_1: 'skip' } } }] },
			expectedCounts: { AAA_1: 150 },
			expectedIds: { present: ['aaa1', 'aaa299'], absent: ['aaa2', 'aaa300'] },
			documentReads: 0,
			recordReadsAtMost: 0,
		},
		'omit with where on the path, 4 candidates → the walk honours it': {
			sourceXml: deepA({ aaa1: 'skip' }),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAAA_1', omit: [{ AAA_1: { where: { aAAA_1: 'skip' } } }] },
			expectedCounts: { AAAA_1: 2 },
			expectedIds: { present: ['aaaa3', 'aaaa4'], absent: ['aaaa1', 'aaaa2'] },
			documentReads: 0,
			recordReadsAtMost: 0,
		},
		'unconditional omit of the tag between scope and candidates, 300 candidates → none, nothing read below the scope':
			{
				sourceXml: wideA(300),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAA_1', omit: ['AA_1'] },
				expectedCounts: { AAA_1: 0 },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
		'document root, no omit, 300 candidates → the tag read alone, nothing climbed': {
			sourceXml: wideA(300),
			ref: { tagName: 'Root', id: 'root' },
			options: { collect: 'AAA_1' },
			expectedCounts: { AAA_1: 300 },
			documentReads: 0,
			// the root itself
			recordReadsAtMost: 1,
		},
		'path collect, 300 matches per level → one document read': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { AAA_1: true } } },
			expectedCounts: { AA_1: 300, AAA_1: 300 },
			documentReads: 1,
			recordReadsAtMost: READS_UP_TO_THE_SWITCH,
		},
		'path collect, 4 matches under a deep root → fetched level by level, no document read': {
			sourceXml: deepA(),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: { AA_1: { AAAA_1: true } } },
			expectedCounts: { AA_1: 1, AAAA_1: 4 },
			documentReads: 0,
			// the root, aa1, aaa1, aaa2 and the 4 leaves
			recordReadsAtMost: 8,
		},
	}

	type Collected = {
		result: Record<string, { id: string; status: string }[]>
		report: Record<string, { count?: number }>
	}

	async function collect(params: {
		document: Document<TestDialecteConfig>
		query: Query<TestDialecteConfig>
		testCase: TestCase
	}): Promise<Collected> {
		const { document, query, testCase } = params
		document.perf.reset()
		const result = (await query.findDescendants(
			testCase.ref,
			testCase.options,
		)) as Collected['result']
		return { result, report: document.perf.report() }
	}

	/** The collect's answer and reads against the case, `created` of its records marked created. */
	function assertCollected(params: {
		collected: Collected
		testCase: TestCase
		created: number
	}): void {
		const { collected, testCase, created } = params
		const { result, report } = collected
		for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
			expect(result[tagName] ?? [], `expected ${tagName} count`).toHaveLength(count)
		}
		const records = Object.values(result).flat()
		const ids = new Set(records.map(({ id }) => id))
		for (const id of testCase.expectedIds?.present ?? []) {
			expect(ids.has(id), `${id} collected`).toBe(true)
		}
		for (const id of testCase.expectedIds?.absent ?? []) {
			expect(ids.has(id), `${id} not collected`).toBe(false)
		}
		expect(
			records.filter(({ status }) => status === 'created'),
			'the staged records',
		).toHaveLength(created)
		expect(report['core::store::getByDocumentId']?.count ?? 0, 'document reads').toBe(
			testCase.documentReads,
		)
		expect(report['core::store::get']?.count ?? 0, 'by-id reads').toBeLessThanOrEqual(
			testCase.recordReadsAtMost,
		)
	}

	describe('committed records', () => {
		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const collected = await collect({ document: source, query: source.query, testCase })
			assertCollected({ collected, testCase, created: 0 })
		}

		runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
	})

	/** The collect runs inside a transaction after the case's staged, uncommitted writes. */
	describe('staged records', () => {
		type StagedCase = TestCase & {
			stage: (tx: Transaction<TestDialecteConfig>) => Promise<void>
			/** How many of the collected records the stage created. */
			created: number
		}

		const stagedCases: Record<string, StagedCase> = {
			'staged create and delete, 300 candidates → created found, deleted gone': {
				sourceXml: wideA(300),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAA_1' },
				stage: async (tx) => {
					await tx.addChild(
						{ tagName: 'AA_1', id: 'aa1' },
						{ tagName: 'AAA_1', attributes: { aAAA_1: 'v' } },
					)
					await tx.delete({ tagName: 'AAA_1', id: 'aaa2' })
				},
				created: 1,
				expectedCounts: { AAA_1: 300 },
				expectedIds: { present: ['aaa1', 'aaa3'], absent: ['aaa2'] },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
			'staged create and delete, 4 candidates → created found, deleted gone': {
				sourceXml: deepA(),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAAA_1' },
				stage: async (tx) => {
					await tx.addChild(
						{ tagName: 'AAA_1', id: 'aaa1' },
						{ tagName: 'AAAA_1', attributes: { aAAAA_1: 'v' } },
					)
					await tx.delete({ tagName: 'AAAA_1', id: 'aaaa4' })
				},
				created: 1,
				expectedCounts: { AAAA_1: 4 },
				expectedIds: { present: ['aaaa1', 'aaaa2', 'aaaa3'], absent: ['aaaa4'] },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
			'staged update makes an ancestor omitted, 300 candidates → the walk sees it': {
				sourceXml: wideA(300),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAA_1', omit: [{ AA_1: { where: { aAA_1: 'skip' } } }] },
				stage: async (tx) => {
					await tx.update({ tagName: 'AA_1', id: 'aa299' }, { attributes: { aAA_1: 'skip' } })
				},
				created: 0,
				expectedCounts: { AAA_1: 149 },
				expectedIds: { present: ['aaa1', 'aaa297'], absent: ['aaa299'] },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
			'staged update makes an ancestor omitted, 4 candidates → the walk sees it': {
				sourceXml: deepA(),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAAA_1', omit: [{ AAA_1: { where: { aAAA_1: 'skip' } } }] },
				stage: async (tx) => {
					await tx.update({ tagName: 'AAA_1', id: 'aaa1' }, { attributes: { aAAA_1: 'skip' } })
				},
				created: 0,
				expectedCounts: { AAAA_1: 2 },
				expectedIds: { present: ['aaaa3', 'aaaa4'], absent: ['aaaa1', 'aaaa2'] },
				documentReads: 0,
				recordReadsAtMost: 0,
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, StagedCase>): Promise<void> {
			const collected = await source.transaction(async (tx) => {
				await testCase.stage(tx)
				return collect({ document: source, query: tx, testCase })
			})
			assertCollected({ collected, testCase, created: testCase.created })
		}

		runTestCases.withoutExport({ testCases: stagedCases, act, dev: { perf: true } })
	})
})
