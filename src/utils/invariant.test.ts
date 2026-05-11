import { invariant } from './invariant'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { DialecteErrorKey } from '@/errors'
import type { BaseTestCase } from '@/test'

describe('invariant', () => {
	describe('truthy conditions pass through', () => {
		type TestCase = BaseTestCase & {
			condition: unknown
		}

		const testCases: Record<string, TestCase> = {
			true: { condition: true },
			'non-empty string': { condition: 'hello' },
			'number 1': { condition: 1 },
			object: { condition: {} },
			array: { condition: [] },
		}

		runTestCases.generic(testCases, (tc) => {
			expect(() => invariant(tc.condition, { detail: 'should not throw' })).not.toThrow()
		})
	})

	describe('falsy conditions throw DialecteError', () => {
		type TestCase = BaseTestCase & {
			condition: unknown
			detail: string
			key?: DialecteErrorKey
			ref?: { tagName: string; id?: string }
			expectedKey: DialecteErrorKey
			expectedDetail: string
		}

		const testCases: Record<string, TestCase> = {
			'false - default key': {
				condition: false,
				detail: 'value is false',
				expectedKey: 'ASSERTION_FAILED',
				expectedDetail: 'value is false',
			},
			'null - default key': {
				condition: null,
				detail: 'value is null',
				expectedKey: 'ASSERTION_FAILED',
				expectedDetail: 'value is null',
			},
			'undefined - default key': {
				condition: undefined,
				detail: 'value is undefined',
				expectedKey: 'ASSERTION_FAILED',
				expectedDetail: 'value is undefined',
			},
			'zero - default key': {
				condition: 0,
				detail: 'value is zero',
				expectedKey: 'ASSERTION_FAILED',
				expectedDetail: 'value is zero',
			},
			'empty string - default key': {
				condition: '',
				detail: 'value is empty',
				expectedKey: 'ASSERTION_FAILED',
				expectedDetail: 'value is empty',
			},
			'custom error key': {
				condition: false,
				detail: 'element missing',
				key: 'ELEMENT_NOT_FOUND',
				expectedKey: 'ELEMENT_NOT_FOUND',
				expectedDetail: 'element missing',
			},
			'with ref': {
				condition: false,
				detail: 'parent not found',
				key: 'ELEMENT_NOT_FOUND',
				ref: { tagName: 'Bay', id: 'bay1' },
				expectedKey: 'ELEMENT_NOT_FOUND',
				expectedDetail: 'parent not found',
			},
		}

		runTestCases.generic(testCases, (tc) => {
			expect(() =>
				invariant(tc.condition, { detail: tc.detail, key: tc.key, ref: tc.ref }),
			).toThrow()

			try {
				invariant(tc.condition, { detail: tc.detail, key: tc.key, ref: tc.ref })
			} catch (error) {
				const cause = (error as Error).cause as Record<string, unknown>
				expect(cause.key).toBe(tc.expectedKey)
				expect(cause.detail).toBe(tc.expectedDetail)
				if (tc.ref) {
					expect(cause.ref).toEqual(tc.ref)
				}
			}
		})
	})
})
