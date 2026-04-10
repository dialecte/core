import { mergeExtensions } from './merge-extensions'

import { describe, it, expect, vi } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

const noop = vi.fn()

const moduleA = {
	query: { getA: noop },
	transaction: { addA: noop },
}

const moduleB = {
	query: { getB: noop },
	transaction: { addB: noop },
}

const moduleAExtended = {
	query: { getAExtra: noop },
}

const moduleAConflictQuery = {
	query: { getA: noop }, // same key as moduleA.query
}

const moduleAConflictTransaction = {
	transaction: { addA: noop }, // same key as moduleA.transaction
}

describe('mergeExtensions', () => {
	describe('output shape', () => {
		type TestCase = BaseTestCase & {
			modules: Parameters<typeof mergeExtensions>[0]
			expectedQuery: string[]
			expectedTransaction: string[]
		}

		const testCases: Record<string, TestCase> = {
			'no inputs - empty registry': {
				modules: {},
				expectedQuery: [],
				expectedTransaction: [],
			},
			'base only - flat registry from base modules': {
				modules: { base: { featureA: moduleA } },
				expectedQuery: ['featureA'],
				expectedTransaction: ['featureA'],
			},
			'custom only - flat registry from custom modules': {
				modules: { custom: { featureB: moduleB } },
				expectedQuery: ['featureB'],
				expectedTransaction: ['featureB'],
			},
			'disjoint modules - all module keys present': {
				modules: { base: { featureA: moduleA }, custom: { featureB: moduleB } },
				expectedQuery: ['featureA', 'featureB'],
				expectedTransaction: ['featureA', 'featureB'],
			},
			'same module key, different method names - merged per method level': {
				modules: { base: { featureA: moduleA }, custom: { featureA: moduleAExtended } },
				expectedQuery: ['featureA'],
				expectedTransaction: ['featureA'],
			},
			'query-only module - transaction group absent for that key': {
				modules: { base: { featureA: { query: { getA: noop } } } },
				expectedQuery: ['featureA'],
				expectedTransaction: [],
			},
			'transaction-only module - query group absent for that key': {
				modules: { base: { featureA: { transaction: { addA: noop } } } },
				expectedQuery: [],
				expectedTransaction: ['featureA'],
			},
		}

		function act({ modules, expectedQuery, expectedTransaction }: TestCase) {
			const result = mergeExtensions(modules)
			expect(Object.keys(result.query)).toEqual(expectedQuery)
			expect(Object.keys(result.transaction)).toEqual(expectedTransaction)
		}

		runTestCases.generic(testCases, act)

		// standalone: verifies merged method-level access, not just key presence
		it('same module key, different methods → merged methods accessible', () => {
			const result = mergeExtensions({
				base: { featureA: moduleA },
				custom: { featureA: moduleAExtended },
			})
			expect(result.query.featureA).toMatchObject({ getA: noop, getAExtra: noop })
		})
	})

	describe('collision detection', () => {
		type TestCase = BaseTestCase & {
			modules: Parameters<typeof mergeExtensions>[0]
			expectedDetail: RegExp
		}

		const testCases: Record<string, TestCase> = {
			'same query method in same module key - throws D6001': {
				modules: {
					base: { featureA: moduleA },
					custom: { featureA: moduleAConflictQuery },
				},
				expectedDetail: /Module "featureA" has conflicting query method\(s\): "getA"/,
			},
			'same transaction method in same module key - throws D6001': {
				modules: {
					base: { featureA: moduleA },
					custom: { featureA: moduleAConflictTransaction },
				},
				expectedDetail: /Module "featureA" has conflicting transaction method\(s\): "addA"/,
			},
		}

		function act({ modules, expectedDetail }: TestCase) {
			expect(() => mergeExtensions(modules)).toThrow(expectedDetail)
		}

		runTestCases.generic(testCases, act)
	})
})
