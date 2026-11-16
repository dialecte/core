import { compareVerdicts } from './compare-verdicts'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { OracleError, OracleIssue } from './conformance.types'
import type { BaseTestCase } from '@/test'

type Verdicts = Parameters<typeof compareVerdicts>[0]

type TestCase = BaseTestCase & {
	verdicts: Verdicts
	/** What the refusal's message carries, absent when the comparison passes. */
	throws?: string
}

const IDS_BY_LINE: ReadonlyMap<number, string> = new Map([
	[1, 'root'],
	[2, 'a1'],
	[3, 'b1'],
])
const PATTERN_ON_A1: OracleIssue = { at: 'a1', code: 'pattern', attribute: 'aA' }
const ENUMERATION_ON_A1: OracleIssue = { at: 'a1', code: 'enumeration', attribute: 'bA' }
const ERROR_ON_A1: OracleError = { line: 2, message: 'a value error' }
const base = { name: 'compare case', idsByLine: IDS_BY_LINE }

describe('compareVerdicts', () => {
	runTestCases.generic<TestCase>(
		{
			'libxml2 flags a record, the engine flags it with the case code → passes': {
				verdicts: {
					...base,
					errors: [ERROR_ON_A1],
					flagged: [PATTERN_ON_A1],
					expected: [PATTERN_ON_A1],
				},
			},
			'two libxml2 errors on one line are one flagged record → passes': {
				verdicts: {
					...base,
					errors: [ERROR_ON_A1, { line: 2, message: 'its follow-up' }],
					flagged: [PATTERN_ON_A1],
					expected: [PATTERN_ON_A1],
				},
			},
			"no error, nothing flagged, expected 'valid' → passes": {
				verdicts: { ...base, errors: [], flagged: [], expected: 'valid' },
			},
			'an error without a line → throws naming the case': {
				verdicts: {
					...base,
					errors: [{ line: 0, message: 'no line' }],
					flagged: [],
					expected: [PATTERN_ON_A1],
				},
				throws: 'compare case',
			},
			'an error on a line the map does not know → throws naming the line': {
				verdicts: {
					...base,
					errors: [{ line: 9, message: 'far away' }],
					flagged: [],
					expected: [PATTERN_ON_A1],
				},
				throws: 'line 9',
			},
			'the engine flags a record libxml2 does not → throws naming the record': {
				verdicts: {
					...base,
					errors: [ERROR_ON_A1],
					flagged: [PATTERN_ON_A1, { at: 'b1', code: 'pattern', attribute: 'aB' }],
					expected: [PATTERN_ON_A1],
				},
				throws: "'b1'",
			},
			"the engine flags a record in a case expected 'valid' → throws naming the record": {
				verdicts: { ...base, errors: [], flagged: [PATTERN_ON_A1], expected: 'valid' },
				throws: "'a1'",
			},
			'the engine misses a record libxml2 flags → throws naming the record': {
				verdicts: { ...base, errors: [ERROR_ON_A1], flagged: [], expected: [PATTERN_ON_A1] },
				throws: "'a1'",
			},
			'one record with two engine issues, one expected → throws naming the second attribute': {
				verdicts: {
					...base,
					errors: [ERROR_ON_A1],
					flagged: [PATTERN_ON_A1, ENUMERATION_ON_A1],
					expected: [PATTERN_ON_A1],
				},
				throws: "'bA'",
			},
			'an expectation naming one record twice → throws naming the record': {
				verdicts: {
					...base,
					errors: [ERROR_ON_A1],
					flagged: [PATTERN_ON_A1],
					expected: [PATTERN_ON_A1, ENUMERATION_ON_A1],
				},
				throws: "'a1' twice",
			},
		},
		({ verdicts, throws }) => {
			if (throws === undefined) {
				expect(() => compareVerdicts(verdicts)).not.toThrow()
				return
			}
			expect(() => compareVerdicts(verdicts)).toThrow(throws)
		},
	)
})
