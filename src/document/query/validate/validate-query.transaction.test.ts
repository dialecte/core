import { actIssue } from './validate-query.fixtures'
import { SOURCE_XML } from './validate-query.fixtures.constants'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'
import type { ValueIssue } from '@/validation'

describe('query.validate.value - in a transaction', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'a parent added in the transaction → judged under it': {
				sourceXml: SOURCE_XML,
				check: async (document) => {
					let issue: ValueIssue | undefined
					await document.transaction(async (tx) => {
						const aa2 = await tx.addChild(
							{ tagName: 'A', id: 'a1' },
							{ tagName: 'AA_2', attributes: { aAA_2: '1' } },
						)
						issue = await tx.validate.value({
							parent: aa2,
							tagName: 'AAA_1',
							attribute: 'aAAA_1',
							value: 'ABC',
						})
					})
					return issue
				},
				expected: { reason: 'pattern', actual: 'ABC', expected: ['[a-z]{3}'], facet: 'pattern' },
			},
		},
		act: actIssue,
	})
})

describe('query.validate / tx.validate - lazy getters', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'query.validate read twice on one query → the same instance': {
				sourceXml: SOURCE_XML,
				check: async (document) => {
					const query = document.query
					expect(query.validate).toBe(query.validate)
					return undefined
				},
			},
			'tx.validate read twice on one transaction → the same instance': {
				sourceXml: SOURCE_XML,
				check: async (document) => {
					await document.transaction(async (tx) => {
						expect(tx.validate).toBe(tx.validate)
					})
					return undefined
				},
			},
		},
		act: actIssue,
	})
})
