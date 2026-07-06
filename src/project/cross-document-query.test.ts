import { Project } from './project'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const NS = TEST_DIALECTE_CONFIG.namespaces.default.uri

function projectName(): string {
	return `cross-doc-query-test-${crypto.randomUUID()}`
}

async function openProjectWithDocs(xmlFiles: { name: string; content: string }[]) {
	const project = new Project({ configs: { default: CONFIG }, storage: { type: 'local' } })
	await project.open(projectName())
	for (const file of xmlFiles) {
		await project.import([new File([file.content], file.name, { type: 'text/xml' })])
	}
	return project
}

// ── queryFirst ───────────────────────────────────────────────────────────────

describe('Project.queryFirst', () => {
	type TestCase = BaseTestCase & {
		files: { name: string; content: string }[]
		searchFor: string
		expectedValue: string | undefined
		expectedCallCount?: number
	}

	const testCases: Record<string, TestCase> = {
		'no documents → undefined': {
			files: [],
			searchFor: 'nonexistent',
			expectedValue: undefined,
		},
		'match in first doc → returns it without checking second': {
			files: [
				{ name: 'a.xml', content: `<Root xmlns="${NS}"><A aA="first"/></Root>` },
				{ name: 'b.xml', content: `<Root xmlns="${NS}"><A aA="second"/></Root>` },
			],
			searchFor: 'first',
			expectedValue: 'first',
			expectedCallCount: 1,
		},
		'no match in first doc → continues to second and returns match': {
			files: [
				{ name: 'a.xml', content: `<Root xmlns="${NS}"><A aA="alpha"/></Root>` },
				{ name: 'b.xml', content: `<Root xmlns="${NS}"><A aA="beta"/></Root>` },
			],
			searchFor: 'beta',
			expectedValue: 'beta',
		},
		'match in first doc → queryFunction not called on remaining docs': {
			files: [
				{ name: 'a.xml', content: `<Root xmlns="${NS}"><A aA="hit"/></Root>` },
				{ name: 'b.xml', content: `<Root xmlns="${NS}"><A aA="unreachable"/></Root>` },
			],
			searchFor: 'hit',
			expectedValue: 'hit',
			expectedCallCount: 1,
		},
	}

	runTestCases.generic(testCases, async (tc) => {
		const project = await openProjectWithDocs(tc.files)
		try {
			let callCount = 0
			const result = await project.queryFirst(async (query) => {
				callCount++
				const records = await query.getRecordsByTagName('A')
				const match = records.find(
					(r) => r.attributes.find((a) => a.name === 'aA')?.value === tc.searchFor,
				)
				return match
			})

			if (tc.expectedValue === undefined) {
				expect(result).toBeUndefined()
			} else {
				expect(result).toBeDefined()
				expect(result!.attributes.find((a) => a.name === 'aA')?.value).toBe(tc.expectedValue)
			}

			if (tc.expectedCallCount !== undefined) {
				expect(callCount).toBe(tc.expectedCallCount)
			}
		} finally {
			await project.destroy()
		}
	})
})

// ── queryAll ─────────────────────────────────────────────────────────────────

describe('Project.queryAll', () => {
	type TestCase = BaseTestCase & {
		files: { name: string; content: string }[]
		expectedNames: string[]
	}

	const testCases: Record<string, TestCase> = {
		'no documents → empty array': {
			files: [],
			expectedNames: [],
		},
		'matches across multiple docs → flat merged array': {
			files: [
				{ name: 'a.xml', content: `<Root xmlns="${NS}"><A aA="one"/><A aA="two"/></Root>` },
				{ name: 'b.xml', content: `<Root xmlns="${NS}"><A aA="three"/></Root>` },
			],
			expectedNames: ['one', 'two', 'three'],
		},
		'no match in some docs → only results from matching docs': {
			files: [
				{ name: 'a.xml', content: `<Root xmlns="${NS}"><A aA="exists"/></Root>` },
				{ name: 'b.xml', content: `<Root xmlns="${NS}"><B aA="other"/></Root>` },
			],
			expectedNames: ['exists'],
		},
	}

	runTestCases.generic(testCases, async (tc) => {
		const project = await openProjectWithDocs(tc.files)
		try {
			const result = await project.queryAll(async (query) => {
				return query.getRecordsByTagName('A')
			})

			const names = result.map((r) => r.attributes.find((a) => a.name === 'aA')?.value)
			expect(names).toHaveLength(tc.expectedNames.length)
			for (const name of tc.expectedNames) {
				expect(names).toContain(name)
			}
		} finally {
			await project.destroy()
		}
	})
})
