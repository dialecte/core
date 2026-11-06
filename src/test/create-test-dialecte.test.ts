import { TEST_DIALECTE_CONFIG } from './config'
import { closeTestContexts, createTestContext, createTestProject } from './create-test-dialecte'
import { TEST_DIALECTE } from './test-dialecte'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { toDialecteError } from '@/errors'
import { InMemoryStore } from '@/store'
import { findInMemoryState, inMemoryStateKeyOf } from '@/store/in-memory/in-memory-state'
import { withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'

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
		for (const project of projects) {
			await project.destroy()
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
				expect(records.every((record) => record.tagName === 'A')).toBe(true)
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
		// the contexts opened by name are connections of their own: closed first, or the destroy is refused
		closeTestContexts()
		for (const project of projects) {
			await project.destroy()
		}
		projects.length = 0
	})

	it('returns a context whose store can retrieve records', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const context = await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})
		const records = await context.store.getByTagNameInDocument('A', context.documentId)
		expect(records).toHaveLength(2)
	})

	it('a context on sqlite by its project’s name and dialecte → that project’s records, read through the engine', async () => {
		withSqliteStorage()
		const { project, source } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'sqlite' },
		})
		projects.push(project)
		const context = await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
			storage: { type: 'sqlite' },
		})
		const records = await context.store.getByTagNameInDocument('A', context.documentId)
		expect(records).toHaveLength(2)
	})

	it('a context on sqlite opened by its project’s name → that project’s destroy refused until closeTestContexts()', async () => {
		withSqliteStorage()
		const { project, source } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'sqlite' },
		})
		projects.push(project)
		await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
			storage: { type: 'sqlite' },
		})
		const refused = await project.destroy().then(
			function destroyed() {
				return 'destroyed'
			},
			function refusedWith(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(refused).toBe('PROJECT_OPEN_ELSEWHERE')
		await closeTestContexts()
		await project.destroy()
	})

	it('a context on sqlite by a name with no dialecte → ASSERTION_FAILED: the engine holds a dialecte’s project', async () => {
		withSqliteStorage()
		const opening = createTestContext({
			databaseName: `no-dialecte-${crypto.randomUUID()}`,
			dialecteId: undefined,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: 'any',
			storage: { type: 'sqlite' },
		})
		const key = await opening.then(
			function opened() {
				return 'opened'
			},
			function refused(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(key).toBe('ASSERTION_FAILED')
	})

	it('a context opened by its project’s name → that project’s destroy refused until closeTestContexts()', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)
		await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})

		const refused = await project.destroy().then(
			function destroyed() {
				return undefined
			},
			function refusedKey(thrown: unknown) {
				return toDialecteError(thrown)?.key
			},
		)
		expect(refused).toBe('PROJECT_OPEN_ELSEWHERE')
		closeTestContexts()
		await project.destroy()
	})

	it('returns a fresh recordCache and empty stagedOperations', async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		const context = await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})
		expect(context.recordCache?.size).toBe(0)
		expect(context.stagedOperations.log).toHaveLength(0)
	})

	it('an in-memory project named, its storage given → the context reads that project’s records', async () => {
		const { project, source } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
		projects.push(project)

		const context = await createTestContext({
			databaseName: project.name,
			dialecteId: project.dialecteId,
			storage: { type: 'inMemory' },
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: source.documentId,
		})

		const records = await context.store.getByTagNameInDocument('A', context.documentId)
		expect(records).toHaveLength(2)
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
				{
					id: 'a1',
					tagName: 'A',
					namespace: { prefix: '', uri: '' },
					attributes: [{ name: 'aA', value: 'a1' }],
					value: '',
					parent: null,
					children: [],
				},
			] as AnyRawRecord[],
		})

		const context = await createTestContext({
			dialecteConfig: TEST_DIALECTE_CONFIG,
			documentId: 'doc',
			store,
		})
		expect(context.store).toBe(store)
		const records = await context.store.getByTagNameInDocument('A', 'doc')
		expect(records).toHaveLength(1)
		await store.destroy()
		// the context opened no store of its own on that name: destroying the given one leaves no state behind
		expect(
			findInMemoryState({ key: inMemoryStateKeyOf({ project: 'context-store' }) }),
		).toBeUndefined()
	})
})

describe('createTestProject from a declaration', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []

	afterEach(async () => {
		for (const project of projects) {
			await project.destroy()
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

		const sourceDocument = await project.getDocument(source.documentId)
		expect(sourceDocument?.configKey).toBe('test')
		const second = await project.initEmptyDocument({ configKey: 'second' })
		const secondDocument = await project.getDocument(second)
		expect(secondDocument?.configKey).toBe('second')
	})

	it('imports the source and target under the config key given', async () => {
		const { project, source, target } = await createTestProject({
			dialecte,
			sourceXml: SIMPLE_XML,
			targetXml: SIMPLE_XML,
			configKey: 'second',
		})
		projects.push(project)

		const sourceDocument = await project.getDocument(source.documentId)
		expect(sourceDocument?.configKey).toBe('second')
		const targetDocument = await project.getDocument(target!.documentId)
		expect(targetDocument?.configKey).toBe('second')
	})

	it('takes its store from the storage parameter', async () => {
		const { project } = await createTestProject({
			dialecte,
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
		projects.push(project)

		expect(project.dialecteId).toBe(dialecte.id)
		expect(
			findInMemoryState({
				key: inMemoryStateKeyOf({ dialecteId: dialecte.id, project: project.name }),
			}),
		).toBeDefined()
	})

	it("without a dialecte: core's own, its documents under the config key `default` as before", async () => {
		const { project, source } = await createTestProject({ sourceXml: SIMPLE_XML })
		projects.push(project)

		expect(project.dialecteId).toBe(TEST_DIALECTE.id)
		expect(TEST_DIALECTE.defaultConfigKey).toBe('default')
		const sourceDocument = await project.getDocument(source.documentId)
		expect(sourceDocument?.configKey).toBe('default')
	})
})

describe('createTestProject - a project the test leaves undestroyed', () => {
	// the cases of this block run in order: each one checks what the one before it left
	const left: { inMemory?: string } = {}
	const openedInBeforeEach: string[] = []
	let fromBeforeAll: TestProjectResult<typeof TEST_DIALECTE_CONFIG> | undefined

	beforeAll(async () => {
		fromBeforeAll = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
	})

	beforeEach(async () => {
		const { project } = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
		openedInBeforeEach.push(project.name)
	})

	it('projects opened in the test, one destroyed by the test itself → nothing thrown at its end', async () => {
		const inMemory = await createTestProject({
			sourceXml: SIMPLE_XML,
			storage: { type: 'inMemory' },
		})
		const destroyedByTheTest = await createTestProject({ sourceXml: SIMPLE_XML })
		left.inMemory = inMemory.project.name
		await destroyedByTheTest.project.destroy()
		expect(
			findInMemoryState({ key: testProjectKey({ name: inMemory.project.name }) }),
		).toBeDefined()
	})

	it('the test before has ended → its projects and the one of its beforeEach are destroyed', async () => {
		// run alone (`-t`, `.only`) the test before has left nothing to check
		expect(left.inMemory).toBeDefined()
		expect(
			findInMemoryState({ key: testProjectKey({ name: left.inMemory ?? '' }) }),
		).toBeUndefined()
		expect(
			findInMemoryState({ key: testProjectKey({ name: openedInBeforeEach[0] ?? '' }) }),
		).toBeUndefined()
	})

	it('a project opened in beforeAll → still open in the later tests, its records read', async () => {
		const project = fromBeforeAll?.project
		if (!project) throw new Error('beforeAll opened no project')
		const documents = await project.getDocuments()
		expect(documents).toHaveLength(1)
		await project.destroy()
	})
})

/** Where the in-memory store keeps a project of core's test dialecte (a test project made with no dialecte named). */
function testProjectKey(params: { name: string }): string {
	return inMemoryStateKeyOf({ dialecteId: TEST_DIALECTE.id, project: params.name })
}
