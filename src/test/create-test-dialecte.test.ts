import { TEST_DIALECTE_CONFIG } from './config'
import { createTestContext, createTestProject } from './create-test-dialecte'
import { TEST_DIALECTE } from './test-dialecte'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { InMemoryStore } from '@/store'

import type { TestProjectResult } from './create-test-dialecte.types'
import type { AnyRawRecord } from '@/types'

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
		expect(context.stagedOperations.log).toHaveLength(0)
	})

	it('reads the store given instead of the local one', async () => {
		const store = new InMemoryStore('context-store', { writable: true })
		await store.open()
		await store.registerDocument({
			id: 'doc',
			name: 'doc',
			extension: '.xml',
			configKey: 'test',
			createdAt: 0,
			status: 'ready',
		})
		await store.bulkWrite('doc', {
			creates: [
				{ id: 'a1', tagName: 'A', attributes: { aA: 'a1' }, parent: null, children: [] },
			] as unknown as AnyRawRecord[],
		})

		const context = await createTestContext({
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: 'doc',
			store,
		})
		expect(context.store).toBe(store)
		expect(await context.store.getByTagNameInDocument('A', 'doc')).toHaveLength(1)
		expect(await Dexie.exists('context-store')).toBe(false)
	})
})

describe('createTestProject from a declaration', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const p of projects) {
			await p.destroy()
		}
		projects.length = 0
	})

	const dialecte = defineDialecte({
		id: 'core/test',
		version: '0.0.0',
		configs: { test: TEST_DIALECTE_CONFIG, second: TEST_DIALECTE_CONFIG },
		defaultConfigKey: 'test',
	})

	it('opens with every config and imports the source with the default one', async () => {
		const { project, source } = await createTestProject({ dialecte, sourceXml: SIMPLE_XML })
		projects.push(project)

		expect((await project.getDocument(source.documentId))?.configKey).toBe('test')
		const second = await project.initEmptyDocument({ configKey: 'second' })
		expect((await project.getDocument(second))?.configKey).toBe('second')
	})

	it('imports the source and target under the config key given', async () => {
		const { project, source, target } = await createTestProject({
			dialecte,
			sourceXml: SIMPLE_XML,
			targetXml: SIMPLE_XML,
			configKey: 'second',
		})
		projects.push(project)

		expect((await project.getDocument(source.documentId))?.configKey).toBe('second')
		expect((await project.getDocument(target!.documentId))?.configKey).toBe('second')
	})

	it('takes its store from the storage parameter', async () => {
		const { project } = await createTestProject({
			dialecte,
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
		projects.push(project)

		expect(await Dexie.exists(project.name)).toBe(false)
	})

	it("without a dialecte: core's own, its documents under the config key `default` as before", async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		expect(TEST_DIALECTE.defaultConfigKey).toBe('default')
		expect((await project.getDocument(source.documentId))?.configKey).toBe('default')
	})
})
