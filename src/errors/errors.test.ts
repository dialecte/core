import { defineErrors, isKnownDialecteError, throwDialecteError, toDialecteError } from './errors'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { runTestCases } from '@/test'

import type { DialecteErrorKey } from './types'
import type { BaseTestCase } from '@/test'

const DIALECT_ERRORS = defineErrors({
	NAME_TAKEN: { code: 'X1001', message: 'The name is already taken' },
})

function catchThrown(act: () => unknown): unknown {
	try {
		act()
	} catch (error) {
		return error
	}
	return undefined
}

describe('throwDialecteError', () => {
	type TestCase = BaseTestCase & {
		act: () => never
		expected: { key: string; code: string; message: string; detail: string; meta?: unknown }
	}

	const testCases: Record<string, TestCase> = {
		'a key of the core catalogue → its code and its default message': {
			act: () => throwDialecteError('ELEMENT_NOT_FOUND', { detail: 'parent not found' }),
			expected: {
				key: 'ELEMENT_NOT_FOUND',
				code: 'D2001',
				message: 'Element not found',
				detail: 'parent not found',
			},
		},
		'an error a dialecte defined → its own key, code and default message': {
			act: () =>
				throwDialecteError(DIALECT_ERRORS.NAME_TAKEN, { detail: 'name "n1" is already taken' }),
			expected: {
				key: 'NAME_TAKEN',
				code: 'X1001',
				message: 'The name is already taken',
				detail: 'name "n1" is already taken',
			},
		},
		'structured data given with the error → carried as it is': {
			act: () =>
				throwDialecteError(DIALECT_ERRORS.NAME_TAKEN, {
					detail: 'name "n1" is already taken',
					meta: { name: 'n1', tagName: 'A', holders: 2 },
				}),
			expected: {
				key: 'NAME_TAKEN',
				code: 'X1001',
				message: 'The name is already taken',
				detail: 'name "n1" is already taken',
				meta: { name: 'n1', tagName: 'A', holders: 2 },
			},
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const thrown = catchThrown(testCase.act)

		// a real Error, for the stack — its message is the developer's detail
		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).message).toBe(testCase.expected.detail)

		const dialecteError = toDialecteError(thrown)
		expect({
			key: dialecteError?.key,
			code: dialecteError?.code,
			message: dialecteError?.message,
			detail: dialecteError?.detail,
			meta: dialecteError?.meta,
		}).toEqual({ meta: undefined, ...testCase.expected })
	})
})

describe('toDialecteError', () => {
	type TestCase = BaseTestCase & { thrown: unknown }

	const testCases: Record<string, TestCase> = {
		'a plain Error → nothing: it is not a structured error': { thrown: new Error('boom') },
		'an Error whose cause is another Error → nothing': {
			thrown: new Error('boom', { cause: new Error('root') }),
		},
		'a value that is not an error → nothing': { thrown: 'boom' },
		'nothing → nothing': { thrown: undefined },
	}

	runTestCases.generic(testCases, (testCase) => {
		expect(toDialecteError(testCase.thrown)).toBeUndefined()
	})
})

describe('defineErrors', () => {
	type TestCase = BaseTestCase

	const testCases: Record<string, TestCase> = {
		'each entry carries its own key → usable wherever a key is asked for': {},
	}

	runTestCases.generic(testCases, () => {
		expect(DIALECT_ERRORS.NAME_TAKEN).toEqual({
			key: 'NAME_TAKEN',
			code: 'X1001',
			message: 'The name is already taken',
		})
	})
})

describe('defineErrors — a catalogue that would make one error look like another', () => {
	type TestCase = BaseTestCase & {
		catalog: Record<string, { code: string; message: string }>
		expectedDetail: string
	}

	const testCases: Record<string, TestCase> = {
		'a key of the core catalogue → refused': {
			catalog: { ELEMENT_NOT_FOUND: { code: 'X1001', message: 'Not found' } },
			expectedDetail: 'defineErrors: "ELEMENT_NOT_FOUND" is a key of the core catalogue',
		},
		'a code of the core catalogue → refused': {
			catalog: { NAME_TAKEN: { code: 'D2001', message: 'The name is already taken' } },
			expectedDetail: 'defineErrors: "NAME_TAKEN" uses "D2001", a code of the core catalogue',
		},
		'two entries with the same code → refused': {
			catalog: {
				NAME_TAKEN: { code: 'X1001', message: 'The name is already taken' },
				NAME_EMPTY: { code: 'X1001', message: 'The name is empty' },
			},
			expectedDetail: 'defineErrors: "NAME_EMPTY" uses "X1001", the code of "NAME_TAKEN"',
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const thrown = catchThrown(() => defineErrors(testCase.catalog))

		expect(toDialecteError(thrown)?.detail).toBe(testCase.expectedDetail)
	})
})

describe('defineErrors — a catalogue written out', () => {
	it('an entry taking a core key or a core code → already refused by the type-check', () => {
		expect(() =>
			defineErrors({
				// @ts-expect-error a key of the core catalogue
				ELEMENT_NOT_FOUND: { code: 'X1001', message: 'Not found' },
			}),
		).toThrow()
		expect(() =>
			defineErrors({
				// @ts-expect-error a code of the core catalogue
				NAME_TAKEN: { code: 'D2001', message: 'The name is already taken' },
			}),
		).toThrow()
	})
})

describe('isKnownDialecteError', () => {
	const OTHER_ERRORS = defineErrors({
		NAME_TAKEN: { code: 'Y1001', message: 'The name is already taken' },
		NAME_EMPTY: { code: 'Y1002', message: 'The name is empty' },
	})

	type TestCase = BaseTestCase & {
		act: () => never
		expected: boolean
	}

	const testCases: Record<string, TestCase> = {
		'a key of a catalogue named → known': {
			act: () =>
				throwDialecteError(DIALECT_ERRORS.NAME_TAKEN, { detail: 'name "n1" is already taken' }),
			expected: true,
		},
		'a key of the core catalogue → known, without naming it': {
			act: () => throwDialecteError('ELEMENT_NOT_FOUND', { detail: 'parent not found' }),
			expected: true,
		},
		'a key of a catalogue not named → not known': {
			act: () => throwDialecteError(OTHER_ERRORS.NAME_EMPTY, { detail: 'name is empty' }),
			expected: false,
		},
		'the same key in another catalogue, with its own code → not known': {
			act: () =>
				throwDialecteError(OTHER_ERRORS.NAME_TAKEN, { detail: 'name "n1" is already taken' }),
			expected: false,
		},
	}

	it('known → its key is one of the core keys or of the catalogues named, nothing else', () => {
		const error = toDialecteError(catchThrown(() => throwDialecteError('UNKNOWN', { detail: '…' })))
		if (!error || !isKnownDialecteError(error, { catalogues: [DIALECT_ERRORS, OTHER_ERRORS] })) {
			throw new Error('expected a known error')
		}

		expectTypeOf(error.key).toEqualTypeOf<DialecteErrorKey | 'NAME_TAKEN' | 'NAME_EMPTY'>()
	})

	runTestCases.generic(testCases, (testCase) => {
		const error = toDialecteError(catchThrown(testCase.act))

		expect(error && isKnownDialecteError(error, { catalogues: [DIALECT_ERRORS] })).toBe(
			testCase.expected,
		)
	})
})
