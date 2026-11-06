// SQLite storage, as an app opts into it
import '@/sqlite'
import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import {
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	UNSERVED_DIALECTE_VERSION,
} from '../runtime/runtime.fixtures.constants'
import { SECOND_FIXTURE_DIALECTE } from '../runtime/runtime.fixtures.dialectes.constants'
import { runsDirectly } from '../served/client/worker-connector'
import { HUB_REGISTRY_KEY } from '../served/hub/hub-client.constants'
import {
	expectTwoDialectesThroughOneRegistration,
	twoDialectesRegistration,
} from './sqlite-connector.fixtures'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { createProjectFactory } from '@/dialecte'
import { toDialecteError } from '@/errors'
import { withSqliteEngine, withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { TEST_DIALECTE, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { HubConnection } from '../served/hub/hub-client.types'
import type { Project } from '@/project'
import type { TestDialecteConfig } from '@/test'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** Core's test dialecte as a dialecte package exports it. */
const createTestProject = createProjectFactory({ dialecte: TEST_DIALECTE })

/** The app's engine registered for the case: core's test dialecte served by its worker. */
function withTestEngine(): void {
	withSqliteEngine({ url: TEST_ENGINE_URL, dialectes: [TEST_DIALECTE] })
}

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

/** A project of the test dialecte opened on `sqlite`: an open the store refuses fails the case on this assertion. */
async function openProject(params: { name: string }): Promise<Project<TestDialecteConfig>> {
	const opening = createTestProject({ storage: { type: 'sqlite' } }).open(params.name)
	await expect(opening).resolves.toBeDefined()
	return opening
}

/** A project of the test dialecte opened on `sqlite`, closed when the case ends. */
async function openOnSqlite(params: { name: string }): Promise<Project<TestDialecteConfig>> {
	const project = await openProject(params)
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
			withTestEngine()
			setUp()
			const name = uniqueName()
			destroyWhenDone({ name })
			const first = await openProject({ name })
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
			const againDocuments = await again.getDocuments()
			expect(againDocuments).toHaveLength(1)
			const recordCount = await countAs({ project: again, documentId })
			expect(recordCount).toBe(3)
			const againDocumentStatus = await again.getDocumentStatus(documentId)
			expect(againDocumentStatus).toEqual({ live: true, ready: true })
		})
	}

	it('two projects of one name in the page, through the hub → one engine: what one imports the other reads', async () => {
		withTestEngine()
		withOwnHubConnection()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await openOnSqlite({ name })
		const second = await openOnSqlite({ name })
		const { documentId } = await first.importFile(file({ as: 1 }))
		const secondDocumentStatus = await second.getDocumentStatus(documentId)
		expect(secondDocumentStatus).toEqual({ live: true, ready: true })
		const recordCount = await countAs({ project: second, documentId })
		expect(recordCount).toBe(1)
	})

	it('a project the page runs directly (its hub out of reach then), a second project of the name once the hub is back → joined there: no refusal, one engine', async () => {
		withTestEngine()
		withOwnHubConnection()
		withoutSharedWorker()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await openOnSqlite({ name })
		vi.unstubAllGlobals()
		const second = await openOnSqlite({ name })
		const { documentId } = await second.importFile(file({ as: 1 }))
		// a second engine through the hub would have waited for the first one's lock: refused PROJECT_ENGINE_BUSY
		const firstDocuments = await first.getDocuments()
		expect(firstDocuments.map(idOf)).toEqual([documentId])
	})

	it('a project closed while the page had no hub, the next open once the hub is there → through the hub', async () => {
		withTestEngine()
		withOwnHubConnection()
		withoutSharedWorker()
		const name = uniqueName()
		destroyWhenDone({ name })
		const first = await openProject({ name })
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

/** The workers the page starts from now on, by address: its own engines, and the hub's shared worker. */
function spyOnWorkers(): { workers: string[]; hubs: string[] } {
	const started = { workers: [] as string[], hubs: [] as string[] }
	const RealWorker = Worker
	const RealSharedWorker = SharedWorker
	class SpiedWorker extends RealWorker {
		constructor(url: string | URL, options?: WorkerOptions) {
			started.workers.push(String(url))
			super(url, options)
		}
	}
	class SpiedSharedWorker extends RealSharedWorker {
		constructor(url: string | URL, options?: string | WorkerOptions) {
			started.hubs.push(String(url))
			super(url, options)
		}
	}
	vi.stubGlobal('Worker', SpiedWorker)
	vi.stubGlobal('SharedWorker', SpiedSharedWorker)
	onTestFinished(function restoreWorkers() {
		vi.unstubAllGlobals()
	})
	return started
}

/** What a call was refused with: the structured error's key, and the message the caller reads. */
async function refusalOf(params: {
	call: () => Promise<unknown>
}): Promise<{ key: string | undefined; message: string }> {
	try {
		await params.call()
	} catch (thrown) {
		return {
			key: toDialecteError(thrown)?.key,
			message: thrown instanceof Error ? thrown.message : String(thrown),
		}
	}
	return { key: 'answered', message: '' }
}

describe('two dialectes of one registration, one engine worker address', () => {
	type TestCase = { setUp: () => void; direct: boolean }
	const testCases: Record<string, TestCase> = {
		'through the origin’s hub': { setUp: withOwnHubConnection, direct: false },
	}
	for (const [description, { setUp, direct }] of Object.entries(testCases)) {
		it(`${description} → a project of each imported and read back, each seeing its own hooks; one name under both dialectes stays two projects`, async () => {
			withSqliteEngine(twoDialectesRegistration())
			setUp()
			await expectTwoDialectesThroughOneRegistration({ name: uniqueName(), direct })
		})
	}
})

describe('a project on sqlite storage whose dialecte the registered engine does not name', () => {
	type TestCase = {
		/** Which dialectes the app registered the worker for: none (nothing registered), or another dialecte only. */
		registered: 'nothing' | 'another dialecte'
		call: 'open' | 'destroy'
	}
	const testCases: Record<string, TestCase> = {
		'no engine registered, opened': { registered: 'nothing', call: 'open' },
		'no engine registered, destroyed by name': { registered: 'nothing', call: 'destroy' },
		'an engine registered for another dialecte, opened': {
			registered: 'another dialecte',
			call: 'open',
		},
		'an engine registered for another dialecte, destroyed by name': {
			registered: 'another dialecte',
			call: 'destroy',
		},
	}
	for (const [description, { registered, call }] of Object.entries(testCases)) {
		it(`${description} → PROJECT_SQLITE_ENGINE_NOT_REGISTERED naming registerSqliteEngine and the dialecte, no worker started, no hub asked`, async () => {
			if (registered === 'nothing') withSqliteStorage()
			else withSqliteEngine({ url: TEST_ENGINE_URL, dialectes: [SECOND_FIXTURE_DIALECTE] })
			withOwnHubConnection()
			const started = spyOnWorkers()
			const refused = await refusalOf({
				call: function openOrDestroy() {
					const factory = createTestProject
					return call === 'open'
						? factory({ storage: { type: 'sqlite' } }).open(uniqueName())
						: factory.destroyProject({ name: uniqueName(), storage: { type: 'sqlite' } })
				},
			})
			expect(refused.key).toBe('PROJECT_SQLITE_ENGINE_NOT_REGISTERED')
			expect(refused.message).toContain('registerSqliteEngine')
			expect(refused.message).toContain(TEST_DIALECTE.id)
			// the other cause: a copy of the library of another SQLite storage version registered the engine
			expect(refused.message).toContain('a copy of @dialecte/core of another')
			expect(started).toEqual({ workers: [], hubs: [] })
		})
	}

	it('a project of a registered dialecte at another version → PROJECT_DIALECTE_VERSION_MISMATCH refused by the hub (origin hub), not NOT_REGISTERED: a registration names a dialecte by id', async () => {
		withTestEngine()
		withOwnHubConnection()
		const factory = createProjectFactory({
			dialecte: { ...TEST_DIALECTE, version: UNSERVED_DIALECTE_VERSION },
		})
		const refused = await refusalOf({
			call: function openOtherVersion() {
				return factory({ storage: { type: 'sqlite' } }).open(uniqueName())
			},
		})
		expect(refused.key).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
	})

	it('a project made before the engine was registered, opened after it → opens (the store is resolved when open() is called, so the registration is read then)', async () => {
		withSqliteStorage()
		withOwnHubConnection()
		const built = createTestProject({ storage: { type: 'sqlite' } })
		withTestEngine()
		const name = uniqueName()
		destroyWhenDone({ name })
		const opening = built.open(name)
		await expect(opening).resolves.toBeDefined()
		const project = await opening
		onTestFinished(function closeProject() {
			return project.close()
		})
		const documents = await project.getDocuments()
		expect(documents).toEqual([])
	})
})
