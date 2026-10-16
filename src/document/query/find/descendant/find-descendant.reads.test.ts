import { READS_BEFORE_SIZING } from './record-source'

import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Collect, FindDescendantsParams } from './find-descendant.types'
import type { Ref } from '@/document'
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
 * How many store reads a collect costs. The climb up the parent chain is kept for a few
 * candidates (each ancestor read once), and gives way to ONE whole-document read once it has
 * cost more than that read would: a collect never issues one `store.get` per ancestor step
 * per candidate. Each case runs one way or the other, and the result is the same either way.
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
		/**
		 * Run the collect inside a transaction after these staged, uncommitted writes: a record
		 * of the last collected tag created under `createUnder` (the collect must return it,
		 * marked `created`), `delete` deleted, `update` updated.
		 */
		stage?: {
			createUnder?: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
			delete?: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
			update?: {
				ref: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
				attributes: Record<string, string>
			}
		}
	}

	const testCases: Record<string, TestCase> = {
		'300 candidates one level under the root → one document read, no climb per candidate': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1' },
			expectedCounts: { AAA_1: 300 },
			documentReads: 1,
			recordReadsAtMost: READS_UP_TO_THE_SWITCH,
		},
		'4 candidates three levels under a deep root → climbs, no document read, shared ancestors read once':
			{
				sourceXml: deepA(),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAAA_1' },
				expectedCounts: { AAAA_1: 4 },
				documentReads: 0,
				// the root, then one read per distinct ancestor between root and candidates: aaa1, aaa2, aa1
				recordReadsAtMost: 4,
			},
		'omit with where on the path, 300 candidates → the document read honours it': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1', omit: [{ AA_1: { where: { aAA_1: 'skip' } } }] },
			expectedCounts: { AAA_1: 150 },
			expectedIds: { present: ['aaa1', 'aaa299'], absent: ['aaa2', 'aaa300'] },
			documentReads: 1,
			recordReadsAtMost: READS_UP_TO_THE_SWITCH,
		},
		'omit with where on the path, 4 candidates → the climb honours it': {
			sourceXml: deepA({ aaa1: 'skip' }),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAAA_1', omit: [{ AAA_1: { where: { aAAA_1: 'skip' } } }] },
			expectedCounts: { AAAA_1: 2 },
			expectedIds: { present: ['aaaa3', 'aaaa4'], absent: ['aaaa1', 'aaaa2'] },
			documentReads: 0,
			recordReadsAtMost: 4,
		},
		'unconditional omit of the tag between root and candidates, 300 candidates → none': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1', omit: ['AA_1'] },
			expectedCounts: { AAA_1: 0 },
			// decided on the parent refs alone: no climb, no document read
			documentReads: 0,
			recordReadsAtMost: 1,
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
		'staged create and delete, 300 candidates, document read in use → created found, deleted gone':
			{
				sourceXml: wideA(300),
				ref: { tagName: 'A', id: 'a1' },
				options: { collect: 'AAA_1' },
				stage: {
					createUnder: { tagName: 'AA_1', id: 'aa1' },
					delete: { tagName: 'AAA_1', id: 'aaa2' },
				},
				expectedCounts: { AAA_1: 300 },
				expectedIds: { present: ['aaa1', 'aaa3'], absent: ['aaa2'] },
				documentReads: 1,
				recordReadsAtMost: READS_UP_TO_THE_SWITCH,
			},
		'staged create and delete, 4 candidates, climbing → created found, deleted gone': {
			sourceXml: deepA(),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAAA_1' },
			stage: {
				createUnder: { tagName: 'AAA_1', id: 'aaa1' },
				delete: { tagName: 'AAAA_1', id: 'aaaa4' },
			},
			expectedCounts: { AAAA_1: 4 },
			expectedIds: { present: ['aaaa1', 'aaaa2', 'aaaa3'], absent: ['aaaa4'] },
			documentReads: 0,
			recordReadsAtMost: 4,
		},
		// aa299 is read after the switch (custom ids come in key order: aaa1, aaa10, aaa100...), so
		// only the staged overlay of the document read can tell it is now omitted
		'staged update makes an ancestor omitted, 300 candidates → the document read sees it': {
			sourceXml: wideA(300),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAA_1', omit: [{ AA_1: { where: { aAA_1: 'skip' } } }] },
			stage: { update: { ref: { tagName: 'AA_1', id: 'aa299' }, attributes: { aAA_1: 'skip' } } },
			expectedCounts: { AAA_1: 149 },
			expectedIds: { present: ['aaa1', 'aaa297'], absent: ['aaa299'] },
			documentReads: 1,
			recordReadsAtMost: READS_UP_TO_THE_SWITCH,
		},
		'staged update makes an ancestor omitted, 4 candidates → the climb sees it': {
			sourceXml: deepA(),
			ref: { tagName: 'A', id: 'a1' },
			options: { collect: 'AAAA_1', omit: [{ AAA_1: { where: { aAAA_1: 'skip' } } }] },
			stage: { update: { ref: { tagName: 'AAA_1', id: 'aaa1' }, attributes: { aAAA_1: 'skip' } } },
			expectedCounts: { AAAA_1: 2 },
			expectedIds: { present: ['aaaa3', 'aaaa4'], absent: ['aaaa1', 'aaaa2'] },
			documentReads: 0,
			recordReadsAtMost: 4,
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const collectedTag = Object.keys(testCase.expectedCounts).at(
			-1,
		) as ElementsOf<TestDialecteConfig>

		async function collectAndAssert(query: typeof source.query): Promise<void> {
			source.perf.reset()
			const result = (await query.findDescendants(testCase.ref, testCase.options)) as Record<
				string,
				{ id: string; status: string }[]
			>
			for (const [tagName, count] of Object.entries(testCase.expectedCounts)) {
				expect(result[tagName] ?? [], `expected ${tagName} count`).toHaveLength(count)
			}
			const ids = new Set(Object.values(result).flatMap((group) => group.map(({ id }) => id)))
			for (const id of testCase.expectedIds?.present ?? []) {
				expect(ids.has(id), `${id} collected`).toBe(true)
			}
			for (const id of testCase.expectedIds?.absent ?? []) {
				expect(ids.has(id), `${id} not collected`).toBe(false)
			}
			if (testCase.stage?.createUnder) {
				expect(
					(result[collectedTag] ?? []).filter(({ status }) => status === 'created'),
					'the staged record',
				).toHaveLength(1)
			}
			const report = source.perf.report()
			expect(report['core::store::getByDocumentId']?.count ?? 0, 'document reads').toBe(
				testCase.documentReads,
			)
			expect(report['core::store::get']?.count ?? 0, 'by-id reads').toBeLessThanOrEqual(
				testCase.recordReadsAtMost,
			)
		}

		const { stage } = testCase
		if (!stage) {
			await collectAndAssert(source.query)
			return
		}
		await source.transaction(async (tx) => {
			if (stage.createUnder) {
				await tx.addChild(
					stage.createUnder as never,
					{ tagName: collectedTag, attributes: { [`a${collectedTag}`]: 'v' } } as never,
				)
			}
			if (stage.delete) await tx.delete(stage.delete as never)
			if (stage.update)
				await tx.update(stage.update.ref as never, { attributes: stage.update.attributes } as never)
			await collectAndAssert(tx as unknown as typeof source.query)
		})
	}

	runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
})
