import { runsDirectly } from '../../engine/client/worker-connector'
import { HUB_REGISTRY_KEY } from '../../engine/hub/hub-client.constants'
import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from '../runtime/runtime.fixtures.constants'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { createProjectFactory } from '@/dialecte'
import { TEST_DIALECTE, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { HubConnection } from '../../engine/hub/hub-client.types'
import type { Project } from '@/project'
import type { TestDialecteConfig } from '@/test'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** Core's test dialecte as a dialecte package exports it: its engine worker beside. */
const createTestProject = createProjectFactory({
	dialecte: TEST_DIALECTE,
	engineUrl: TEST_ENGINE_URL,
})

function uniqueName(): string {
	return `sqlite-option-${crypto.randomUUID()}`
}

function file(params: { as: number }): File {
	const children = Array.from({ length: params.as }, function childOf(_, index) {
		return `<A aA="a${index}"/>`
	}).join('')
	return new File([`<Root ${XMLNS_DEFAULT_NAMESPACE}>${children}</Root>`], 'source.xml', {
		type: 'text/xml',
	})
}

/** A project of the test dialecte opened on `sqlite`, closed when the case ends. */
async function openOnSqlite(params: { name: string }): Promise<Project<TestDialecteConfig>> {
	const project = await createTestProject({ storage: { type: 'sqlite' } }).open(params.name)
	onTestFinished(function closeProject() {
		return project.close()
	})
	return project
}

/** The project of that name destroyed once the case ends, after every project of it closed. */
function destroyWhenDone(params: { name: string }): void {
	onTestFinished(async function destroyProject() {
		const project = await createTestProject({ storage: { type: 'sqlite' } }).open(params.name)
		await project.destroy()
	})
}

async function countAs(params: {
	project: Project<TestDialecteConfig>
	documentId: string
}): Promise<number> {
	const records = await params.project
		.openDocument(params.documentId)
		.query.getRecordsByTagName('A')
	return records.length
}

/**
 * The realm's hub connection forgotten for the case (a new one made by the stores), closed after it, the one before
 * put back.
 */
function withOwnHubConnection(): void {
	const registry = globalThis as unknown as Record<symbol, unknown>
	const kept = registry[HUB_REGISTRY_KEY]
	delete registry[HUB_REGISTRY_KEY]
	onTestFinished(async function closeAndRestore() {
		const made = registry[HUB_REGISTRY_KEY] as Promise<HubConnection | undefined> | undefined
		const connection = await made?.catch(function noConnection() {
			return undefined
		})
		connection?.close()
		registry[HUB_REGISTRY_KEY] = kept
	})
}

/** The browser offering no SharedWorker for the case: no hub, every project run by this page. */
function withoutSharedWorker(): void {
	vi.stubGlobal('SharedWorker', undefined)
	onTestFinished(function restoreSharedWorker() {
		vi.unstubAllGlobals()
	})
}

describe('a project on sqlite storage', () => {
	type TestCase = { setUp: () => void; direct: boolean }
	const testCases: Record<string, TestCase> = {
		'through the origin’s hub (the page never called connectHub: the store offers its own engine)':
			{
				setUp: withOwnHubConnection,
				direct: false,
			},
		'with no SharedWorker (direct: the page runs the engine)': {
			setUp: function noHub() {
				withOwnHubConnection()
				withoutSharedWorker()
			},
			direct: true,
		},
	}
	for (const [description, { setUp, direct }] of Object.entries(testCases)) {
		it(`${description} → opens, imports, commits, and opened again reads what it wrote`, async () => {
			setUp()
			const name = uniqueName()
			destroyWhenDone({ name })
			const first = await createTestProject({ storage: { type: 'sqlite' } }).open(name)
			const { documentId } = await first.importFile(file({ as: 2 }))
			const document = first.openDocument(documentId)
			await document.transaction(async function addOne(tx) {
				const root = await tx.getRoot()
				await tx.addChild(root, { tagName: 'A', attributes: { aA: 'added' } })
			})
			await first.close()
			const again = await openOnSqlite({ name })
			// through the hub the page runs no engine of its own for it (a hub that refused it would have failed the open)
			expect(runsDirectly({ name, dialecteId: TEST_DIALECTE.id })).toBe(direct)
			expect(await again.getDocuments()).toHaveLength(1)
			expect(await countAs({ project: again, documentId })).toBe(3)
			expect(await again.getDocumentStatus(documentId)).toEqual({ live: true, ready: true })
		})
	}

	it('two projects of one name in the page, through the hub → one engine: what one imports the other reads', async () => {
		withOwnHubConnection()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await openOnSqlite({ name })
		const second = await openOnSqlite({ name })
		const { documentId } = await first.importFile(file({ as: 1 }))
		expect(await second.getDocumentStatus(documentId)).toEqual({ live: true, ready: true })
		expect(await countAs({ project: second, documentId })).toBe(1)
	})

	it('a project the page runs directly (its hub out of reach then), a second project of the name once the hub is back → joined there: no refusal, one engine', async () => {
		withOwnHubConnection()
		withoutSharedWorker()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await openOnSqlite({ name })
		vi.unstubAllGlobals()
		const second = await openOnSqlite({ name })
		const { documentId } = await second.importFile(file({ as: 1 }))
		// a second engine through the hub would have waited for the first one's lock: refused PROJECT_ENGINE_BUSY
		expect((await first.getDocuments()).map(idOf)).toEqual([documentId])
	})

	it('a project closed while the page had no hub, the next open once the hub is there → through the hub', async () => {
		withOwnHubConnection()
		withoutSharedWorker()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await createTestProject({ storage: { type: 'sqlite' } }).open(name)
		expect(runsDirectly({ name, dialecteId: TEST_DIALECTE.id })).toBe(true)
		await first.close()
		vi.unstubAllGlobals()
		await openOnSqlite({ name })
		expect(runsDirectly({ name, dialecteId: TEST_DIALECTE.id })).toBe(false)
	})
})

function idOf(document: { id: string }): string {
	return document.id
}
