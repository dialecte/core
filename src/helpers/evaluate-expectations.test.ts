import { evaluateExpectations } from './evaluate-expectations'

import { describe, expect } from 'vitest'

import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'

import type { Expectation, ExpectationsOutcome } from './evaluate-expectations.types'
import type { BaseXmlTestCase, TestCases } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}`

describe('evaluateExpectations', () => {
	type TestCase = BaseXmlTestCase & {
		expectations: Expectation[]
		/** Staged in a prepared transaction before the expectations are read on its query. */
		stagedChild?: { parentId: string; aAAA_1: string }
		expected: {
			passedCount: number
			failed: { tag: string; actualCount: number; message: string }[]
		}
	}

	/** One A: AA_1 holds one AAA_1, each of the two AA_2 holds one more. */
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A aA="A">
				<AA_1 aAA_1="one" dev:db-id="aa1"><AAA_1 aAAA_1="abc"/></AA_1>
				<AA_2 aAA_2="5" dev:db-id="aa2-5"><AAA_1 aAAA_1="def"/></AA_2>
				<AA_2 aAA_2="6" dev:db-id="aa2-6"><AAA_1 aAAA_1="ghi"/></AA_2>
			</A>
		</Root>
	`

	const testCases: TestCases<TestCase> = {
		'expectation of 2 AAA_1 under an AA_1, document has 1 → failed with the count': {
			sourceXml,
			expectations: [{ tag: 'AAA_1', under: { tag: 'AA_1' }, count: 2 }],
			expected: {
				passedCount: 0,
				failed: [{ tag: 'AAA_1', actualCount: 1, message: 'expected 2 AAA_1 under AA_1, found 1' }],
			},
		},
		'where on an attribute → only matching records counted': {
			sourceXml,
			expectations: [
				{ tag: 'AAA_1', where: { aAAA_1: 'def' }, count: 1 },
				{ tag: 'AAA_1', where: { aAAA_1: ['abc', 'ghi'] }, count: 3 },
			],
			expected: {
				passedCount: 1,
				failed: [
					{
						tag: 'AAA_1',
						actualCount: 2,
						message: 'expected 3 AAA_1[aAAA_1="abc"|"ghi"], found 2',
					},
				],
			},
		},
		'where on the under scope → only records under matching scopes counted': {
			sourceXml,
			expectations: [
				{ tag: 'AAA_1', under: { tag: 'AA_2', where: { aAA_2: '5' } }, count: 1 },
				{ tag: 'AAA_1', under: { tag: 'AA_2' }, count: 1 },
			],
			expected: {
				passedCount: 1,
				failed: [{ tag: 'AAA_1', actualCount: 2, message: 'expected 1 AAA_1 under AA_2, found 2' }],
			},
		},
		'no count → at least one; count 0 → none': {
			sourceXml,
			expectations: [
				{ tag: 'AA_1' },
				{ tag: 'AAA_2' },
				{ tag: 'AAA_2', count: 0 },
				{ tag: 'AA_1', count: 0 },
			],
			expected: {
				passedCount: 2,
				failed: [
					{ tag: 'AAA_2', actualCount: 0, message: 'expected at least one AAA_2, found 0' },
					{ tag: 'AA_1', actualCount: 1, message: 'expected no AA_1, found 1' },
				],
			},
		},
		'prepared transaction query → staged records counted': {
			sourceXml,
			stagedChild: { parentId: 'aa1', aAAA_1: 'new' },
			expectations: [
				{ tag: 'AAA_2', under: { tag: 'AA_1' }, count: 1 },
				{ tag: 'AAA_2', where: { aAAA_2: 'new' } },
			],
			expected: { passedCount: 2, failed: [] },
		},
	}

	runTestCases.withoutExport<TestCase>({
		testCases,
		act: async ({ testCase, source }) => {
			let outcome: ExpectationsOutcome
			if (testCase.stagedChild) {
				const { parentId, aAAA_1 } = testCase.stagedChild
				const prepared = await source.prepare(async (tx) => {
					await tx.addChild(
						{ tagName: 'AA_1', id: parentId },
						{ tagName: 'AAA_2', attributes: { aAAA_2: aAAA_1 } },
					)
				})
				outcome = await evaluateExpectations(prepared.query, {
					expectations: testCase.expectations,
				})
				prepared.discard()
			} else {
				outcome = await evaluateExpectations(source.query, { expectations: testCase.expectations })
			}

			expect(outcome.passed).toHaveLength(testCase.expected.passedCount)
			expect(
				outcome.failed.map((failure) => ({
					tag: failure.expectation.tag,
					actualCount: failure.actualCount,
					message: failure.message,
				})),
			).toEqual(testCase.expected.failed)
		},
	})
})
