import { pushedFilterOf } from './pushed-filter'

import { describe, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, runTestCases } from '@/test'

import type { PushedFilter } from './find-by-attributes.types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig } from '@/types'

type TestCase = BaseTestCase & {
	tagName: string
	attributes: Record<string, unknown> | undefined
	expected: PushedFilter
}

describe('pushedFilterOf', () => {
	const testCases: Record<string, TestCase> = {
		'a plain attribute with one value → pushed with it': {
			tagName: 'A',
			attributes: { aA: 'v' },
			expected: { kind: 'pushed', attributes: [{ name: 'aA', values: ['v'] }] },
		},
		"a list → pushed with its string values, '' and other values dropped": {
			tagName: 'A',
			attributes: { aA: ['v', '', 3, undefined, 'w'], bA: 'x' },
			expected: {
				kind: 'pushed',
				attributes: [
					{ name: 'aA', values: ['v', 'w'] },
					{ name: 'bA', values: ['x'] },
				],
			},
		},
		'an attribute given undefined → left out of the filter': {
			tagName: 'A',
			attributes: { aA: 'v', bA: undefined },
			expected: { kind: 'pushed', attributes: [{ name: 'aA', values: ['v'] }] },
		},
		'only undefined values → kept: the tag read': {
			tagName: 'A',
			attributes: { aA: undefined },
			expected: { kind: 'kept' },
		},
		'no filter at all → kept': {
			tagName: 'A',
			attributes: undefined,
			expected: { kind: 'kept' },
		},
		'an empty filter → kept': {
			tagName: 'A',
			attributes: {},
			expected: { kind: 'kept' },
		},
		'xsi:type beside a plain attribute → the plain one pushed, xsi:type kept back': {
			tagName: 'DD_1',
			attributes: { 'xsi:type': 'tDD_1A', aDD_1: 's' },
			expected: { kind: 'pushed', attributes: [{ name: 'aDD_1', values: ['s'] }] },
		},
		'xsi:type alone → kept': {
			tagName: 'DD_1',
			attributes: { 'xsi:type': ['tDD_1A', 'tDD_1B'] },
			expected: { kind: 'kept' },
		},
		'an attribute QName-typed for the tag → kept': {
			tagName: 'EE_1',
			attributes: { aEE_1: 'xs:integer' },
			expected: { kind: 'kept' },
		},
		"'' alone → unmatchable": {
			tagName: 'A',
			attributes: { aA: '' },
			expected: { kind: 'unmatchable' },
		},
		"an empty list, or one of '' and undefined → unmatchable": {
			tagName: 'A',
			attributes: { aA: 'v', bA: ['', undefined] },
			expected: { kind: 'unmatchable' },
		},
		"a pushed attribute of '' beside xsi:type → unmatchable": {
			tagName: 'DD_1',
			attributes: { 'xsi:type': 'tDD_1A', aDD_1: [] },
			expected: { kind: 'unmatchable' },
		},
	}

	function act(testCase: TestCase): void {
		expect(
			pushedFilterOf({
				dialecteConfig: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig,
				tagName: testCase.tagName,
				attributes: testCase.attributes,
			}),
		).toEqual(testCase.expected)
	}

	runTestCases.generic(testCases, act)
})
