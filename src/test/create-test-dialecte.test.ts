import { TEST_DIALECTE_CONFIG } from './config'
import { createTestContext, createTestProject } from './create-test-dialecte'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import type { TestProjectResult } from './create-test-dialecte'

type TestCase = {
	description: string
	xmlString: string
	validate: (result: TestProjectResult<typeof TEST_DIALECTE_CONFIG>) => Promise<void>
}

const SIMPLE_XML = /* xml */ `
<Root>
	<A aA="a1" bA="hello" />
	<A aA="a2" bA="world" />
	<B aB="b1" />
</Root>
`

describe('createTestProject', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) {
			await p.destroy()
		}
		projects.length = 0
	})

	const testCases: TestCase[] = [
		{
			description: 'returns project with source document',
			xmlString: SIMPLE_XML,
			validate: async ({ project, source }) => {
				expect(source.document).toBeDefined()
				expect(project.name).toMatch(/^test-/)
			},
		},
		{
			description: 'source document query can retrieve records by tagName',
			xmlString: SIMPLE_XML,
			validate: async ({ source }) => {
				const records = await source.document.query.getRecordsByTagName('A')
				expect(records).toHaveLength(2)
				expect(records.every((r) => r.tagName === 'A')).toBe(true)
			},
		},
		{
			description: 'destroy removes the project database',
			xmlString: '<Root />',
			validate: async ({ project }) => {
				const dbName = project.name
				await project.destroy()
				const exists = await Dexie.exists(dbName)
				expect(exists).toBe(false)
				// Prevent afterEach from double-destroying
				projects.pop()
			},
		},
		{
			description: 'each call creates a unique project',
			xmlString: SIMPLE_XML,
			validate: async ({ project }) => {
				const other = await createTestProject({ sourceXml: SIMPLE_XML })
				projects.push(other.project)
				expect(project.name).not.toBe(other.project.name)
			},
		},
	]

	for (const { description, xmlString, validate } of testCases) {
		it(description, async () => {
			const result = await createTestProject({ sourceXml: xmlString })
			projects.push(result.project)
			await validate(result)
		})
	}
})

describe('createTestContext', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) {
			await p.destroy()
		}
		projects.length = 0
	})

	it('returns a context whose store can retrieve records', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const context = await createTestContext({
			databaseName: project.name,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})
		const records = await context.store.getByTagNameInDocument('A', context.documentId)
		expect(records).toHaveLength(2)
	})

	it('returns a fresh recordCache and empty stagedOperations', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const context = await createTestContext({
			databaseName: project.name,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})
		expect(context.recordCache?.size).toBe(0)
		expect(context.stagedOperations).toHaveLength(0)
	})
})
