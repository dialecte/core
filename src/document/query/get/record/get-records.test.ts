import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestProject,
	runTestCases,
} from '@/test'

import type { Ref } from '@/document'
import type { PerfReport } from '@/perf'
import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { ElementsOf } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getRecords', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			refs: Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>[]
			expectedResults: ({ id: string; tagName: string; status: 'unchanged' } | undefined)[]
		}

		const testCases: TestCases<TestCase> = {
			'returns empty array for empty refs': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				refs: [],
				expectedResults: [],
			},
			'returns a single found record': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				refs: [{ tagName: 'A', id: 'a1' }],
				expectedResults: [{ id: 'a1', tagName: 'A', status: 'unchanged' }],
			},
			'returns undefined for a missing ref': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				refs: [{ tagName: 'A', id: 'non-existent' }],
				expectedResults: [undefined],
			},
			'preserves order of results matching order of refs': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="first" />
						<A ${customId}="a2" aA="second" />
						<A ${customId}="a3" aA="third" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a3' },
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				expectedResults: [
					{ id: 'a3', tagName: 'A', status: 'unchanged' },
					{ id: 'a1', tagName: 'A', status: 'unchanged' },
					{ id: 'a2', tagName: 'A', status: 'unchanged' },
				],
			},
			'mixes found and undefined for partial matches': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'missing' },
				],
				expectedResults: [{ id: 'a1', tagName: 'A', status: 'unchanged' }, undefined],
			},
			'resolves refs of different tagNames': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
						<B ${customId}="b1" aB="v" />
					</Root>
				`,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'B', id: 'b1' },
				],
				expectedResults: [
					{ id: 'a1', tagName: 'A', status: 'unchanged' },
					{ id: 'b1', tagName: 'B', status: 'unchanged' },
				],
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const results = await source.query.getRecords(testCase.refs)

			expect(results).toHaveLength(testCase.expectedResults.length)

			for (let i = 0; i < testCase.expectedResults.length; i++) {
				const expected = testCase.expectedResults[i]
				if (expected === undefined) {
					expect(results[i]).toBeUndefined()
				} else {
					expect(results[i]).toMatchObject(expected)
				}
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('sees staged created record in batch', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="p" />
				</Root>
			`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const [existing, created] = await tx.getRecords([
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1' },
					])

					expect(existing).toBeDefined()
					expect(created?.status).toBe('created')
				})
			} finally {
				await project.destroy()
			}
		})

		it('returns undefined for staged deleted record in batch', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="p">
						<AA_1 ${customId}="aa1" aAA_1="v" />
					</A>
				</Root>
			`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const [deleted] = await tx.getRecords([{ tagName: 'AA_1', id: 'aa1' }])

					expect(deleted).toBeUndefined()
				})
			} finally {
				await project.destroy()
			}
		})
	})

	describe('store round trips', () => {
		type AnyRef = Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>
		type Reads = {
			get: number
			getMany: number
			getByTagName: number
			miss: number
			cacheHit: number
		}
		type TestCase = BaseXmlTestCase & {
			refs: AnyRef[]
			/** Run in a transaction: stage an update of `update`, read `readFirst`, call, then read `readAfter`. */
			transaction?: {
				update?: Ref<TestDialecteConfig, 'A'>
				readFirst?: { call: 'getRecord' | 'getRecords'; refs: AnyRef[] }
				readAfter?: Ref<TestDialecteConfig, 'A'>
			}
			expected: {
				/** The ids answered, or the mismatch the call throws. */
				outcome:
					| {
							ids: (string | undefined)[]
							statuses?: (string | undefined)[]
							distinctCopies?: [number, number]
					  }
					| { mismatch: { ref: AnyRef; actualTagName: string } }
				/** Store reads from the first read of the transaction (or the call) on, `readAfter` included. */
				reads: Reads
			}
		}

		const sourceXml = /* xml */ `
			<Root ${ns}>
				<A ${customId}="a1" aA="v" />
				<A ${customId}="a2" aA="v" />
				<A ${customId}="a3" aA="v" />
				<B ${customId}="b1" aB="v" />
			</Root>
		`
		const noReads: Reads = { get: 0, getMany: 0, getByTagName: 0, miss: 0, cacheHit: 0 }

		const testCases: TestCases<TestCase> = {
			'no ref reads nothing': {
				sourceXml,
				refs: [],
				expected: { outcome: { ids: [] }, reads: noReads },
			},
			'refs by id are read in one getMany, in the order given': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a3' },
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				expected: {
					outcome: { ids: ['a3', 'a1', 'a2'] },
					reads: { ...noReads, getMany: 1, miss: 3 },
				},
			},
			'a missing id is read in the same getMany and answered undefined': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'missing' },
				],
				expected: {
					outcome: { ids: ['a1', undefined] },
					reads: { ...noReads, getMany: 1, miss: 2 },
				},
			},
			'a ref given twice is read once and answered at each position with its own copy': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
					{ tagName: 'A', id: 'a1' },
				],
				expected: {
					outcome: { ids: ['a1', 'a2', 'a1'], distinctCopies: [0, 2] },
					reads: { ...noReads, getMany: 1, miss: 2 },
				},
			},
			'a ref without id resolves by tag name, the others in one getMany': {
				sourceXml,
				refs: [{ tagName: 'B' }, { tagName: 'A', id: 'a1' }],
				expected: {
					outcome: { ids: ['b1', 'a1'] },
					reads: { ...noReads, getMany: 1, getByTagName: 1, miss: 2 },
				},
			},
			'a record staged in the transaction is answered staged, not read from the store': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				transaction: { update: { tagName: 'A', id: 'a1' } },
				expected: {
					outcome: { ids: ['a1', 'a2'], statuses: ['updated', 'unchanged'] },
					reads: { ...noReads, getMany: 1, miss: 1 },
				},
			},
			'records the transaction already read are answered from its cache': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				transaction: {
					readFirst: {
						call: 'getRecords',
						refs: [
							{ tagName: 'A', id: 'a1' },
							{ tagName: 'A', id: 'a2' },
						],
					},
				},
				expected: {
					outcome: { ids: ['a1', 'a2'] },
					reads: { ...noReads, getMany: 1, miss: 2, cacheHit: 2 },
				},
			},
			'a record the transaction read with getRecord is answered from its cache': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'A', id: 'a2' },
				],
				transaction: { readFirst: { call: 'getRecord', refs: [{ tagName: 'A', id: 'a1' }] } },
				expected: {
					outcome: { ids: ['a1', 'a2'] },
					reads: { ...noReads, get: 1, getMany: 1, miss: 2, cacheHit: 1 },
				},
			},
			'a ref naming another tag than its stored record throws ELEMENT_TAGNAME_MISMATCH': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a2' },
					{ tagName: 'B', id: 'a1' },
				],
				expected: {
					outcome: { mismatch: { ref: { tagName: 'B', id: 'a1' }, actualTagName: 'A' } },
					reads: { ...noReads, getMany: 1, miss: 2 },
				},
			},
			'of two mismatching refs, the first in input order throws, not the first id read': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a2' },
					{ tagName: 'B', id: 'a1' },
					{ tagName: 'B', id: 'a2' },
				],
				expected: {
					outcome: { mismatch: { ref: { tagName: 'B', id: 'a1' }, actualTagName: 'A' } },
					reads: { ...noReads, getMany: 1, miss: 2 },
				},
			},
			'one id under two tags: the ref naming the other tag throws': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a1' },
					{ tagName: 'B', id: 'a1' },
				],
				expected: {
					outcome: { mismatch: { ref: { tagName: 'B', id: 'a1' }, actualTagName: 'A' } },
					reads: { ...noReads, getMany: 1, miss: 1 },
				},
			},
			'a mismatch still caches every record the batch read': {
				sourceXml,
				refs: [
					{ tagName: 'B', id: 'a1' },
					{ tagName: 'A', id: 'a3' },
				],
				transaction: { readAfter: { tagName: 'A', id: 'a3' } },
				expected: {
					outcome: { mismatch: { ref: { tagName: 'B', id: 'a1' }, actualTagName: 'A' } },
					reads: { ...noReads, getMany: 1, miss: 2, cacheHit: 1 },
				},
			},
			'a staged record named under another tag throws before any store read': {
				sourceXml,
				refs: [
					{ tagName: 'A', id: 'a2' },
					{ tagName: 'B', id: 'a1' },
				],
				transaction: { update: { tagName: 'A', id: 'a1' } },
				expected: {
					outcome: { mismatch: { ref: { tagName: 'B', id: 'a1' }, actualTagName: 'A' } },
					reads: noReads,
				},
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const { transaction } = testCase
			if (!transaction) {
				source.perf.reset()
				const outcome = await source.query.getRecords(testCase.refs).then(
					(results) => ({ results }),
					(error: unknown) => ({ error }),
				)
				assertOutcome({ outcome, expected: testCase.expected, report: source.perf.report() })
				return
			}

			// Read inside, assert outside: an assertion thrown in a transaction surfaces as its failure.
			const { outcome, report } = await source.transaction(async (tx) => {
				if (transaction.update)
					await tx.update(transaction.update, { attributes: { aA: 'staged' } })
				source.perf.reset()
				const { readFirst, readAfter } = transaction
				if (readFirst?.call === 'getRecords') await tx.getRecords(readFirst.refs)
				if (readFirst?.call === 'getRecord') await tx.getRecord(readFirst.refs[0])
				const read = await tx.getRecords(testCase.refs).then(
					(results) => ({ results }),
					(error: unknown) => ({ error }),
				)
				if (readAfter) await tx.getRecord(readAfter)
				return { outcome: read, report: source.perf.report() }
			})
			assertOutcome({ outcome, expected: testCase.expected, report })
		}

		function assertOutcome(params: {
			outcome: { results: ({ id: string; status: string } | undefined)[] } | { error: unknown }
			expected: TestCase['expected']
			report: PerfReport
		}): void {
			const { outcome, expected, report } = params
			expect({
				get: report['core::store::get']?.count ?? 0,
				getMany: report['core::store::getMany']?.count ?? 0,
				getByTagName: report['core::store::getByTagName']?.count ?? 0,
				miss: report['core::query::getRecord.miss']?.count ?? 0,
				cacheHit: report['core::query::getRecord.cacheHit']?.count ?? 0,
			}).toEqual(expected.reads)

			if ('mismatch' in expected.outcome) {
				const { ref, actualTagName } = expected.outcome.mismatch
				expect('error' in outcome, 'the read throws').toBe(true)
				const error = 'error' in outcome ? outcome.error : undefined
				expect(toDialecteError(error)).toMatchObject({
					key: 'ELEMENT_TAGNAME_MISMATCH',
					ref,
					meta: { id: ref.id, expectedTagName: ref.tagName, actualTagName },
				})
				return
			}
			if ('error' in outcome) throw outcome.error
			const { results } = outcome
			const { ids, statuses, distinctCopies } = expected.outcome
			expect(results.map((record) => record?.id)).toEqual(ids)
			if (statuses) expect(results.map((record) => record?.status)).toEqual(statuses)
			if (distinctCopies) expect(results[distinctCopies[0]]).not.toBe(results[distinctCopies[1]])
		}

		runTestCases.withoutExport({ testCases, act, dev: { perf: true } })
	})
})
