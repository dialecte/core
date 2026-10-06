import { invariant } from './invariant'

import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { runTestCases } from '@/test'

import type { DialecteErrorDefinition, DialecteErrorKey } from '@/errors'
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
			key?: DialecteErrorKey | DialecteErrorDefinition
			ref?: { tagName: string; id?: string }
			meta?: Record<string, unknown>
			expectedKey: string
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
			'an error a dialecte defined, with what it is about → its key and the data': {
				condition: false,
				detail: 'name "n1" is already taken',
				key: { key: 'NAME_TAKEN', code: 'X1001', message: 'The name is already taken' },
				meta: { name: 'n1' },
				expectedKey: 'NAME_TAKEN',
				expectedDetail: 'name "n1" is already taken',
			},
		}

		runTestCases.generic(testCases, (tc) => {
			expect(() =>
				invariant(tc.condition, { detail: tc.detail, key: tc.key, ref: tc.ref, meta: tc.meta }),
			).toThrow()

			try {
				invariant(tc.condition, { detail: tc.detail, key: tc.key, ref: tc.ref, meta: tc.meta })
			} catch (error) {
				const cause = (error as Error).cause as Record<string, unknown>
				expect(cause.key).toBe(tc.expectedKey)
				expect(cause.detail).toBe(tc.expectedDetail)
				expect(cause.meta).toEqual(tc.meta)
				if (tc.ref) {
					expect(cause.ref).toEqual(tc.ref)
				}
			}
		})
	})

	describe('the method a failure reports', () => {
		type TestCase = BaseTestCase & {
			act: () => void
			expectedMethod: string
		}

		function reserveName(): void {
			invariant(false, { detail: 'name "n1" is already taken' })
		}

		const testCases: Record<string, TestCase> = {
			'a function asserting through invariant → that function, not invariant': {
				act: () => reserveName(),
				expectedMethod: 'reserveName',
			},
			'a function called under another name, as an extension method is → its own name': {
				act: reserveName,
				expectedMethod: 'reserveName',
			},
		}

		runTestCases.generic(testCases, (testCase) => {
			let thrown: unknown
			try {
				testCase.act()
			} catch (error) {
				thrown = error
			}

			expect(toDialecteError(thrown)?.method).toMatch(new RegExp(`::${testCase.expectedMethod}$`))
		})
	})
})
