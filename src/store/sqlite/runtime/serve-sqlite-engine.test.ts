import {
	CONTRACT_ENGINE_URL,
	CONTRACT_SESSION_DIAGNOSTICS,
} from '../../contract/store-contract.constants'
import {
	contractFile,
	makeDocument,
	makeRecord,
	sessionRecords,
} from '../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../contract/store-contract.import-session'
import { EngineStore } from '../../engine/engine-store'
import { POOL_CAPACITY } from './runtime.constants'
import {
	TEST_ENGINE_URL,
	clientOf,
	damageDatabaseHeader,
	engineLockQueue,
	fixtureFile,
	fixtureUrl,
	holdEngineLock,
	holdPoolFile,
	isEngineLockFree,
	makeBlankPool,
	openMessage,
	orderFixture,
	poolFileDigests,
	poolState,
	removePoolDirectory,
	startEngineWorker,
	uniqueProject,
} from './runtime.fixtures'
import {
	FIXTURE_DIALECTE,
	OTHER_FIXTURE_DIALECTE,
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	INSTALL_REFUSAL,
	LOCK_QUEUE_TIMEOUT_MS,
	LOCK_RACE_BUDGET_MS,
	ONE_BUDGET_SLACK_MS,
	OPEN_FAILURE,
	REPEATED_FIXTURE,
	SECOND_FIXTURE_CONFIG,
	SECOND_FIXTURE_DIAGNOSTICS,
	TWO_DIALECTES_FIXTURE,
	UNGIVEN_FIXTURE_DIALECTE_ID,
	UNSAFE_POOL_SQLITE,
	UNSERVED_DIALECTE_VERSION,
} from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { rejectionKey } from '@/errors/errors.fixtures'
import { Project } from '@/project/project'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'
import { TEST_DIALECTE_CONFIG } from '@/test'
import { TEST_CONFIG_KEY } from '@/test/constant'

import type { EngineApi } from '../../engine/engine.types'
import type {
	FixtureDialecteRef,
	RuntimeFixtureOrder,
	RuntimeFixtureScenario,
} from './runtime.fixtures.types'
import type { AnyDialecteConfig } from '@/types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** What a case leaves: its workers ended, its pools removed. */
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An engine worker the case drives; ended, and the project's pool removed, after the case. */
function engineWorker(params: {
	project: string
	url?: string
}): ReturnType<typeof startEngineWorker> {
	const started = startEngineWorker({ url: params.url })
	cleanups.push(started.end, () => removePoolDirectory({ project: params.project }))
	return started
}

/** A pool made by an engine that wrote a document then closed. */
async function closedPoolWithDocument(params: { project: string }): Promise<void> {
	const { control, end } = engineWorker({ project: params.project })
	await control.request({ message: openMessage(params), expect: 'opened' })
	const engine = await clientOf({ control, clientId: 'writer' })
	await engine.registerDocument(makeDocument())
	await control.request({ message: { type: 'close' }, expect: 'closed' })
	end()
}

describe('an engine worker opening its project', () => {
	it('no private file system → STORE_UNAVAILABLE, nothing created', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'no-opfs' }) })
		const controlRequestRefusalKey = await rejectionKey({
			action: control.request({ message: openMessage({ project }), expect: 'opened' }),
		})
		expect(controlRequestRefusalKey).toBe('STORE_UNAVAILABLE')
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	})

	describe('the project’s engine lock held elsewhere', () => {
		it('taken only if free → PROJECT_OPEN_ELSEWHERE without waiting, nothing created', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project })
			const budgetMs = 10_000
			const startedAt = performance.now()
			const controlRequestRefusalKey = await rejectionKey({
				action: control.request({
					message: openMessage({ project, budgetMs }),
					expect: 'opened',
				}),
			})
			expect(controlRequestRefusalKey).toBe('PROJECT_OPEN_ELSEWHERE')
			// a wait for the lock would last the whole budget; the worker's own start (its SQLite load) counts here too
			expect(performance.now() - startedAt).toBeLessThan(budgetMs)
			const poolStatus = await poolState({ project })
			expect(poolStatus).toEqual({ exists: false, files: 0 })
		})

		it('waited for within 300 ms → PROJECT_ENGINE_BUSY once they have passed', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project })
			const startedAt = performance.now()
			const controlRequestRefusalKey = await rejectionKey({
				action: control.request({
					message: openMessage({ project, lock: 'wait', budgetMs: 300 }),
					expect: 'opened',
				}),
			})
			expect(controlRequestRefusalKey).toBe('PROJECT_ENGINE_BUSY')
			expect(performance.now() - startedAt).toBeGreaterThanOrEqual(290)
		})

		it('held by another engine worker → PROJECT_OPEN_ELSEWHERE; that engine goes on', async () => {
			const project = uniqueProject()
			const first = engineWorker({ project })
			await first.control.request({ message: openMessage({ project }), expect: 'opened' })
			const second = engineWorker({ project })
			const secondControlRequestRefusalKey = await rejectionKey({
				action: second.control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(secondControlRequestRefusalKey).toBe('PROJECT_OPEN_ELSEWHERE')
			const engine = await clientOf({ control: first.control, clientId: 'c-1' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([])
		})
	})

	it('a pool file another worker still holds → PROJECT_ENGINE_BUSY naming it, the pool intact; once let go, the data there', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const holder = await holdPoolFile({ project })
		cleanups.push(holder.release)
		const { control } = engineWorker({ project })
		const thrown = await control
			.request({ message: openMessage({ project, budgetMs: 600 }), expect: 'opened' })
			.catch((error: unknown) => error)
		expect(toDialecteError(thrown)).toMatchObject({
			key: 'PROJECT_ENGINE_BUSY',
			meta: { project, retriedOn: [holder.file] },
		})
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: true, files: POOL_CAPACITY })
		await holder.release()
		const next = engineWorker({ project })
		await next.control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control: next.control, clientId: 'reader' })
		const engineDocuments = await engine.getDocuments()
		expect(engineDocuments).toEqual([makeDocument()])
	})

	it.each(['', '.', '..'])(
		'a project named %j → refused PROJECT_NAME_INVALID before any file is touched, the engine lock let go',
		async (project) => {
			const started = startEngineWorker({})
			cleanups.push(started.end)
			const refused = await rejectionKey({
				action: started.control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(refused).toBe('PROJECT_NAME_INVALID')
			const lockFree = await isEngineLockFree({ project })
			expect(lockFree).toBe(true)
		},
	)

	it.each(['', '.', '..'])(
		'a project named %j, its engine lock held elsewhere → refused PROJECT_NAME_INVALID: the name is refused before the lock is asked',
		async (project) => {
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const started = startEngineWorker({})
			cleanups.push(started.end)
			const refused = await rejectionKey({
				action: started.control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(refused).toBe('PROJECT_NAME_INVALID')
		},
	)

	it('a new project where too little space is left → STORE_QUOTA_EXCEEDED, nothing created', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'small-quota' }) })
		const thrown = await control
			.request({ message: openMessage({ project }), expect: 'opened' })
			.catch((error: unknown) => error)
		expect(toDialecteError(thrown)).toMatchObject({
			key: 'STORE_QUOTA_EXCEEDED',
			meta: { project, available: 1000 },
		})
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	})

	it('an import needing more space than is left → STORE_QUOTA_EXCEEDED, nothing registered, not applied', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'import-quota' }) })
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'c-1' })
		const body = Array.from(
			{ length: 15_000 },
			(_, index) => `<A aA="${'x'.repeat(100)}${index}"/>`,
		)
		const engineImportFileRefusalKey = await rejectionKey({
			action: engine.importFile({
				file: contractFile({ body: body.join('') }),
				writeId: 'w-big',
			}),
		})
		expect(engineImportFileRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
		const engineDocuments = await engine.getDocuments()
		expect(engineDocuments).toEqual([])
		const engineWriteOutcome = await engine.getWriteOutcome({ writeId: 'w-big' })
		expect(engineWriteOutcome).toBe('not-applied')
	})

	describe('the origin out of storage while it writes (the file system refuses the writes)', () => {
		/**
		 * An engine on the `disk-full` fixture, a document registered (and what `prepare` writes), then the disk filled
		 * (after some writes).
		 */
		async function engineOnFullDisk(
			params: {
				afterWrites?: number
				failing?: boolean
				prepare?: (engine: Awaited<ReturnType<typeof clientOf>>) => Promise<void>
			} = {},
		): Promise<Awaited<ReturnType<typeof clientOf>>> {
			const project = uniqueProject()
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'disk-full' }) })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'c-1' })
			await engine.registerDocument(makeDocument())
			await params.prepare?.(engine)
			await orderDisk(
				params.failing
					? { type: 'write-fails' }
					: { type: 'disk-full', afterWrites: params.afterWrites },
			)
			return engine
		}

		/** The fixture told how its disk is; resolves once the engine worker has taken the order. */
		function orderDisk(order: RuntimeFixtureOrder): Promise<void> {
			return orderFixture({ order })
		}

		it('a commit → STORE_QUOTA_EXCEEDED, nothing of it applied', async () => {
			const engine = await engineOnFullDisk()
			const creates = Array.from({ length: 2_000 }, (_, index) => makeRecord({ id: `r${index}` }))
			const engineCommitRefusalKey = await rejectionKey({
				action: engine.commit({
					documentId: 'doc-1',
					writeId: 'w-1',
					creates,
					updates: [],
					deletes: [],
				}),
			})
			expect(engineCommitRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
			const engineRecordCount = await engine.count('doc-1')
			expect(engineRecordCount).toBe(0)
		})

		type RefusedWrite = {
			/** Written before the disk fills. */
			prepare?: (engine: Awaited<ReturnType<typeof engineOnFullDisk>>) => Promise<void>
			write: (engine: Awaited<ReturnType<typeof engineOnFullDisk>>) => Promise<unknown>
			/** What is read afterwards: nothing of the write there. */
			readAfter: (engine: Awaited<ReturnType<typeof engineOnFullDisk>>) => Promise<unknown>
			expectedAfter: unknown
		}
		const refusedWrites: Record<string, RefusedWrite> = {
			'a bulk write → STORE_QUOTA_EXCEEDED, nothing of it applied': {
				write: (engine) =>
					engine.bulkWrite('doc-1', {
						creates: Array.from({ length: 2_000 }, (_, index) => makeRecord({ id: `r${index}` })),
					}),
				readAfter: (engine) => engine.count('doc-1'),
				expectedAfter: 0,
			},
			'a document registered → STORE_QUOTA_EXCEEDED, not registered': {
				write: (engine) =>
					engine.registerDocument(
						makeDocument({ id: 'doc-2', metadata: { note: 'x'.repeat(100_000) } }),
					),
				readAfter: (engine) => engine.getDocument('doc-2'),
				expectedAfter: undefined,
			},
			'an undo → STORE_QUOTA_EXCEEDED, the history and the record as they were': {
				prepare: (engine) => editTwice({ engine }),
				write: (engine) => engine.undo('doc-1'),
				readAfter: (engine) => historyAndValue({ engine }),
				expectedAfter: { history: { canUndo: true, canRedo: false }, value: 'second' },
			},
			'a redo → STORE_QUOTA_EXCEEDED, the history and the record as they were': {
				prepare: async (engine) => {
					await editTwice({ engine })
					await engine.undo('doc-1')
				},
				write: (engine) => engine.redo('doc-1'),
				readAfter: (engine) => historyAndValue({ engine }),
				expectedAfter: { history: { canUndo: true, canRedo: true }, value: 'first' },
			},
		}

		/** `r1` created with `first`, then set to `second`: two commits to step through. */
		async function editTwice(params: {
			engine: Awaited<ReturnType<typeof engineOnFullDisk>>
		}): Promise<void> {
			const { engine } = params
			function commitOf(commitParams: { writeId: string; value: string; created: boolean }) {
				const { writeId, value, created } = commitParams
				return engine.commit({
					documentId: 'doc-1',
					writeId,
					creates: created ? [makeRecord({ id: 'r1', value })] : [],
					updates: created ? [] : [makeRecord({ id: 'r1', value })],
					deletes: [],
				})
			}
			await commitOf({ writeId: 'w-first', value: 'first', created: true })
			await commitOf({ writeId: 'w-second', value: 'second', created: false })
		}

		/** The document's history and the value of `r1`. */
		async function historyAndValue(params: {
			engine: Awaited<ReturnType<typeof engineOnFullDisk>>
		}): Promise<{ history: unknown; value: string | undefined }> {
			const { engine } = params
			return {
				history: await engine.getHistoryStatus('doc-1'),
				value: (await engine.get('r1', 'doc-1'))?.value,
			}
		}

		for (const [description, { prepare, write, readAfter, expectedAfter }] of Object.entries(
			refusedWrites,
		)) {
			it(description, async () => {
				const engine = await engineOnFullDisk({ prepare })
				const writeRefusalKey = await rejectionKey({ action: write(engine) })
				expect(writeRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
				const stateAfterRefusal = await readAfter(engine)
				expect(stateAfterRefusal).toEqual(expectedAfter)
			})
		}

		it('a commit refused by the file system for another reason while room is left → its own key, STORE_COMMIT_FAILED', async () => {
			const engine = await engineOnFullDisk({ failing: true })
			const creates = Array.from({ length: 2_000 }, (_, index) => makeRecord({ id: `r${index}` }))
			const engineCommitRefusalKey = await rejectionKey({
				action: engine.commit({
					documentId: 'doc-1',
					writeId: 'w-1',
					creates,
					updates: [],
					deletes: [],
				}),
			})
			expect(engineCommitRefusalKey).toBe('STORE_COMMIT_FAILED')
		})

		it('an import, the disk filling once it has started writing → STORE_QUOTA_EXCEEDED, nothing registered', async () => {
			const engine = await engineOnFullDisk({ afterWrites: 20 })
			const body = Array.from({ length: 5_000 }, (_, index) => `<A aA="${index}"/>`).join('')
			const engineImportFileRefusalKey = await rejectionKey({
				action: engine.importFile({ file: contractFile({ body }), writeId: 'w-import' }),
			})
			expect(engineImportFileRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
			// the disk full, SQLite cannot even roll back what it began: the aftermath is read once there is room
			await orderDisk({ type: 'disk-free' })
			const engineWriteOutcome = await engine.getWriteOutcome({ writeId: 'w-import' })
			expect(engineWriteOutcome).toBe('not-applied')
			const engineDocument = await engine.getDocument('doc-1')
			expect(engineDocument).toEqual(makeDocument())
		})
	})

	describe('a pool that fails to get ready (its files cannot be opened, none held elsewhere)', () => {
		/** The install-failure fixtures: every file refused, or one file refused while the others are acquired. */
		const failures = {
			'every file refused': { scenario: 'install-fails' },
			'one file refused, the others acquired': { scenario: 'install-fails-on-one' },
		} satisfies Record<string, { scenario: RuntimeFixtureScenario }>

		it.each(Object.entries(failures))(
			'%s → refused, the pool kept byte for byte: a later engine finds its document',
			async (_label, { scenario }) => {
				const project = uniqueProject()
				await closedPoolWithDocument({ project })
				const written = await poolFileDigests({ project })
				expect(Object.keys(written)).toHaveLength(POOL_CAPACITY)
				const broken = engineWorker({ project, url: fixtureUrl({ scenario }) })
				const brokenControlRequestRefusalKey = await rejectionKey({
					action: broken.control.request({ message: openMessage({ project }), expect: 'opened' }),
				})
				expect(brokenControlRequestRefusalKey).toBe(INSTALL_REFUSAL.text)
				const fileDigests = await poolFileDigests({ project })
				expect(fileDigests).toEqual(written)
				broken.end()
				const { control } = engineWorker({ project })
				await control.request({ message: openMessage({ project }), expect: 'opened' })
				const engine = await clientOf({ control, clientId: 'reader' })
				const engineDocuments = await engine.getDocuments()
				expect(engineDocuments).toEqual([makeDocument()])
			},
		)

		it.each(Object.entries(failures))(
			'%s, while another engine waits for its lock → that engine opens as the lock is let go and finds the document',
			async (_label, { scenario }) => {
				const project = uniqueProject()
				await closedPoolWithDocument({ project })
				// the page holds the lock until both engines wait for it, the failing one first: locks are granted in order
				const release = await holdEngineLock({ project })
				cleanups.push(release)
				const waiting = openMessage({ project, lock: 'wait', budgetMs: LOCK_RACE_BUDGET_MS })
				const broken = engineWorker({ project, url: fixtureUrl({ scenario }) })
				const refused = rejectionKey({
					action: broken.control.request({ message: waiting, expect: 'opened' }),
				})
				await expect
					.poll(() => engineLockQueue({ project }), { timeout: LOCK_QUEUE_TIMEOUT_MS })
					.toEqual({ held: 1, pending: 1 })
				const reader = engineWorker({ project })
				// settled either way, so a red case never leaves its rejection unhandled; a refusal says its key
				const opened = reader.control.request({ message: waiting, expect: 'opened' }).then(
					() => 'opened',
					(thrown: unknown) => toDialecteError(thrown)?.key ?? String(thrown),
				)
				await expect
					.poll(() => engineLockQueue({ project }), { timeout: LOCK_QUEUE_TIMEOUT_MS })
					.toEqual({ held: 1, pending: 2 })
				release()
				const refusedOutcome = await refused
				expect(refusedOutcome).toBe(INSTALL_REFUSAL.text)
				const openedOutcome = await opened
				expect(openedOutcome).toBe('opened')
				const engine = await clientOf({ control: reader.control, clientId: 'reader' })
				const engineDocuments = await engine.getDocuments()
				expect(engineDocuments).toEqual([makeDocument()])
			},
		)
	})

	it('a pool that failed to get ready, opened again in the same worker → installed this time, its document there', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const written = await poolFileDigests({ project })
		expect(Object.keys(written)).toHaveLength(POOL_CAPACITY)
		const { control } = engineWorker({
			project,
			url: fixtureUrl({ scenario: 'install-fails-once' }),
		})
		const controlRequestRefusalKey = await rejectionKey({
			action: control.request({ message: openMessage({ project }), expect: 'opened' }),
		})
		expect(controlRequestRefusalKey).toBe(INSTALL_REFUSAL.text)
		const fileDigests = await poolFileDigests({ project })
		expect(fileDigests).toEqual(written)
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'reader' })
		const engineDocuments = await engine.getDocuments()
		expect(engineDocuments).toEqual([makeDocument()])
	})

	describe('an sqlite-wasm older than 3.54.1 (it removes the whole pool when an install fails)', () => {
		it('a project with a document → ASSERTION_FAILED naming the version, its files untouched and the lock let go: a later engine finds the document', async () => {
			const project = uniqueProject()
			await closedPoolWithDocument({ project })
			const written = await poolFileDigests({ project })
			expect(Object.keys(written)).toHaveLength(POOL_CAPACITY)
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'sqlite-3-53' }) })
			const thrown = await control
				.request({ message: openMessage({ project }), expect: 'opened' })
				.catch((error: unknown) => error)
			expect(toDialecteError(thrown)).toMatchObject({
				key: 'ASSERTION_FAILED',
				meta: { project, sqliteVersion: UNSAFE_POOL_SQLITE.libVersion },
			})
			const fileDigests = await poolFileDigests({ project })
			expect(fileDigests).toEqual(written)
			const next = engineWorker({ project })
			await next.control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control: next.control, clientId: 'reader' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([makeDocument()])
		})

		it('its engine lock held elsewhere → ASSERTION_FAILED, not PROJECT_OPEN_ELSEWHERE: refused before the lock is asked', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'sqlite-3-53' }) })
			const controlRequestRefusalKey = await rejectionKey({
				action: control.request({
					message: openMessage({ project, lock: 'if-available' }),
					expect: 'opened',
				}),
			})
			expect(controlRequestRefusalKey).toBe('ASSERTION_FAILED')
		})

		it('a new project → ASSERTION_FAILED, nothing created', async () => {
			const project = uniqueProject()
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'sqlite-3-53' }) })
			const controlRequestRefusalKey = await rejectionKey({
				action: control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(controlRequestRefusalKey).toBe('ASSERTION_FAILED')
			const poolStatus = await poolState({ project })
			expect(poolStatus).toEqual({ exists: false, files: 0 })
		})
	})

	describe('a project whose pool holds data but whose database is gone (its header damaged, the pages there)', () => {
		const damages = {
			'its header digest damaged': { damage: 'digest' },
			'its header blanked': { damage: 'blank' },
		} satisfies Record<string, { damage: 'digest' | 'blank' }>

		it.each(Object.entries(damages))(
			'%s → PROJECT_DATABASE_LOST, every file byte for byte: the next engine is refused the same',
			async (_label, { damage }) => {
				const project = uniqueProject()
				await closedPoolWithDocument({ project })
				await damageDatabaseHeader({ project, damage })
				const damaged = await poolFileDigests({ project })
				const { control } = engineWorker({ project })
				const thrown = await control
					.request({ message: openMessage({ project }), expect: 'opened' })
					.catch((error: unknown) => error)
				expect(toDialecteError(thrown)).toMatchObject({
					key: 'PROJECT_DATABASE_LOST',
					meta: { project },
				})
				const fileDigests = await poolFileDigests({ project })
				expect(fileDigests).toEqual(damaged)
				const next = engineWorker({ project })
				const nextControlRequestRefusalKey = await rejectionKey({
					action: next.control.request({ message: openMessage({ project }), expect: 'opened' }),
				})
				expect(nextControlRequestRefusalKey).toBe('PROJECT_DATABASE_LOST')
			},
		)

		it('its header damaged while the worker that closed the project keeps the pool paused, opened again in that worker → PROJECT_DATABASE_LOST, every file byte for byte', async () => {
			const project = uniqueProject()
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const writer = await clientOf({ control, clientId: 'writer' })
			await writer.registerDocument(makeDocument())
			await control.request({ message: { type: 'close' }, expect: 'closed' })
			await damageDatabaseHeader({ project, damage: 'digest' })
			const damaged = await poolFileDigests({ project })
			function open(): Promise<string> {
				return rejectionKey({
					action: control.request({ message: openMessage({ project }), expect: 'opened' }),
				})
			}
			const keyOfOpen = await open()
			expect(keyOfOpen).toBe('PROJECT_DATABASE_LOST')
			const fileDigests = await poolFileDigests({ project })
			expect(fileDigests).toEqual(damaged)
			// the pool the worker keeps paused removed there
			await control.request({
				message: {
					type: 'destroy',
					project,
					dialecteId: FIXTURE_DIALECTE.dialecteId,
					lock: 'if-available',
					budgetMs: 5_000,
				},
				expect: 'destroyed',
			})
			const poolStatus = await poolState({ project })
			expect(poolStatus).toEqual({ exists: false, files: 0 })
			const keyOfOpenAfterDestroy = await open()
			expect(keyOfOpenAfterDestroy).toBe('resolved')
			const reader = await clientOf({ control, clientId: 'reader' })
			const readerDocuments = await reader.getDocuments()
			expect(readerDocuments).toEqual([])
		})

		it('refused through a Project, which then destroys the project → the pool gone; opened again → an empty project', async () => {
			const name = uniqueProject()
			await closedPoolWithDocument({ project: name })
			await damageDatabaseHeader({ project: name, damage: 'digest' })
			cleanups.push(() => removePoolDirectory({ project: name }))
			const store = new EngineStore({
				name,
				connector: createSqliteWorkerConnector({
					...FIXTURE_DIALECTE,
					name,
					engineUrl: TEST_ENGINE_URL,
				}),
			})
			const project = new Project({
				configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
				storage: { type: 'custom', store },
			})
			const projectOpenRefusalKey = await rejectionKey({ action: project.open(name) })
			expect(projectOpenRefusalKey).toBe('PROJECT_DATABASE_LOST')
			await project.destroy()
			const poolStatus = await poolState({ project: name })
			expect(poolStatus).toEqual({ exists: false, files: 0 })
			await project.open(name)
			const projectDocuments = await project.getDocuments()
			expect(projectDocuments).toEqual([])
			await project.destroy()
		})

		it('a paused pool taken back after a wait for its lock, one of its files held → PROJECT_ENGINE_BUSY within one budget for both', async () => {
			const project = uniqueProject()
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			await control.request({ message: { type: 'close' }, expect: 'closed' })
			const holder = await holdPoolFile({ project })
			cleanups.push(holder.release)
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const budgetMs = 2_000
			const startedAt = performance.now()
			const reopening = control
				.request({ message: openMessage({ project, lock: 'wait', budgetMs }), expect: 'opened' })
				.catch((error: unknown) => error)
			// the lock let go three quarters into the budget: the probe has the rest of it, not a budget of its own
			setTimeout(release, (budgetMs * 3) / 4)
			// refused by the probe (the file it retried on), not by the wait for the lock
			const reopeningOutcome = await reopening
			expect(toDialecteError(reopeningOutcome)).toMatchObject({
				key: 'PROJECT_ENGINE_BUSY',
				meta: { project, retriedOn: [holder.file] },
			})
			expect(performance.now() - startedAt).toBeLessThan(budgetMs + ONE_BUDGET_SLACK_MS)
		})

		it('refused, then opened again in the same worker → refused again; destroyed there → opened empty', async () => {
			const project = uniqueProject()
			await closedPoolWithDocument({ project })
			await damageDatabaseHeader({ project, damage: 'digest' })
			const { control } = engineWorker({ project })
			function open(): Promise<string> {
				return rejectionKey({
					action: control.request({ message: openMessage({ project }), expect: 'opened' }),
				})
			}
			const keyOfFirstOpen = await open()
			expect(keyOfFirstOpen).toBe('PROJECT_DATABASE_LOST')
			const keyOfSecondOpen = await open()
			expect(keyOfSecondOpen).toBe('PROJECT_DATABASE_LOST')
			await control.request({
				message: {
					type: 'destroy',
					project,
					dialecteId: FIXTURE_DIALECTE.dialecteId,
					lock: 'if-available',
					budgetMs: 5_000,
				},
				expect: 'destroyed',
			})
			const poolStatus = await poolState({ project })
			expect(poolStatus).toEqual({ exists: false, files: 0 })
			const keyOfOpenAfterDestroy = await open()
			expect(keyOfOpenAfterDestroy).toBe('resolved')
			const engine = await clientOf({ control, clientId: 'reader' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([])
		})
	})

	describe('a pool that never held a database (an install or a creation that ended early) → opened as a new project', () => {
		const pools = {
			'every file a blank header': { sizes: Array.from({ length: POOL_CAPACITY }, () => 4096) },
			'a partial pool: a blank header and a file not yet written': { sizes: [4096, 0] },
		} satisfies Record<string, { sizes: number[] }>

		it('a partial pool where too little space is left → STORE_QUOTA_EXCEEDED, as for a new project; its files unchanged', async () => {
			const project = uniqueProject()
			await makeBlankPool({ project, sizes: [4096, 0] })
			const blank = await poolFileDigests({ project })
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'small-quota' }) })
			const controlRequestRefusalKey = await rejectionKey({
				action: control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(controlRequestRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
			const fileDigests = await poolFileDigests({ project })
			expect(fileDigests).toEqual(blank)
		})

		it.each(Object.entries(pools))('%s', async (_label, { sizes }) => {
			const project = uniqueProject()
			await makeBlankPool({ project, sizes })
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'writer' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([])
			await engine.registerDocument(makeDocument())
			const documents = await engine.getDocuments()
			expect(documents).toEqual([makeDocument()])
		})
	})

	describe('an open that fails before its database is opened', () => {
		const failures = {
			'the dialecte fails to make its hooks': {
				scenario: 'hooks-fail',
				refusal: `Error: ${OPEN_FAILURE.hooks}`,
			},
			'the database cannot be opened': {
				scenario: 'database-fails',
				refusal: `Error: ${OPEN_FAILURE.database}`,
			},
		} satisfies Record<string, { scenario: RuntimeFixtureScenario; refusal: string }>

		it.each(Object.entries(failures))(
			'%s, on a new project → refused with that failure; the next engine makes the project',
			async (_label, { scenario, refusal }) => {
				const project = uniqueProject()
				const failing = engineWorker({ project, url: fixtureUrl({ scenario }) })
				const failingControlRequestRefusalKey = await rejectionKey({
					action: failing.control.request({
						message: openMessage({ project }),
						expect: 'opened',
					}),
				})
				expect(failingControlRequestRefusalKey).toBe(refusal)
				failing.end()
				const { control } = engineWorker({ project })
				await control.request({ message: openMessage({ project }), expect: 'opened' })
				const engine = await clientOf({ control, clientId: 'reader' })
				const engineDocuments = await engine.getDocuments()
				expect(engineDocuments).toEqual([])
			},
		)

		it('the database cannot be opened, on a project with a document → refused, the pool kept byte for byte: the next engine reads it', async () => {
			const project = uniqueProject()
			await closedPoolWithDocument({ project })
			const written = await poolFileDigests({ project })
			expect(Object.keys(written)).toHaveLength(POOL_CAPACITY)
			const failing = engineWorker({ project, url: fixtureUrl({ scenario: 'database-fails' }) })
			const failingControlRequestRefusalKey = await rejectionKey({
				action: failing.control.request({ message: openMessage({ project }), expect: 'opened' }),
			})
			expect(failingControlRequestRefusalKey).toBe(`Error: ${OPEN_FAILURE.database}`)
			const fileDigests = await poolFileDigests({ project })
			expect(fileDigests).toEqual(written)
			failing.end()
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'reader' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([makeDocument()])
		})
	})

	it('an import whose file would fit at twice its size but not at eight times (2 MiB free, a file of ~400 KB) → STORE_QUOTA_EXCEEDED, nothing registered', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'import-quota' }) })
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'c-1' })
		const file = contractFile({
			body: Array.from({ length: 4_000 }, (_, index) => `<A aA="${'x'.repeat(80)}${index}"/>`).join(
				'',
			),
		})
		const freeBytes = 2 * 1024 * 1024
		expect(2 * file.size).toBeLessThan(freeBytes)
		expect(8 * file.size).toBeGreaterThan(freeBytes)
		const engineImportFileRefusalKey = await rejectionKey({
			action: engine.importFile({ file, writeId: 'w-between' }),
		})
		expect(engineImportFileRefusalKey).toBe('STORE_QUOTA_EXCEEDED')
		const engineDocuments = await engine.getDocuments()
		expect(engineDocuments).toEqual([])
	})

	it('closed, then opened again in the same worker → the pool resumed, not installed, its data there', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project })
		const opened = await control.request({ message: openMessage({ project }), expect: 'opened' })
		expect(opened.resumed).toBe(false)
		await (await clientOf({ control, clientId: 'writer' })).registerDocument(makeDocument())
		await control.request({ message: { type: 'close' }, expect: 'closed' })
		const reopened = await control.request({ message: openMessage({ project }), expect: 'opened' })
		expect(reopened.resumed).toBe(true)
		const client = await clientOf({ control, clientId: 'reader' })
		const documents = await client.getDocuments()
		expect(documents).toEqual([makeDocument()])
	})
})

describe('an engine worker whose import leaves its connection inside a transaction', () => {
	it('the import refused, the engine let go with its lock (its worker ending); the next engine finds the document there, no trace of the import', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'stranded-window' }) })
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'c-1' })
		await engine.registerDocument(makeDocument())
		await orderFixture({ order: { type: 'strand-windows' } })
		const refused = await rejectionKey({
			action: engine.importFile({
				file: contractFile({ body: '<B aB="B0"/><B aB="B1"/>' }),
				writeId: 'w-stranded',
			}),
		})
		// every commit of the worker refused: the import fails at its window's commit
		expect(refused).toBe('STORE_COMMIT_FAILED')
		await vi.waitFor(
			async function lockLetGo() {
				const lockFree = await isEngineLockFree({ project })
				expect(lockFree).toBe(true)
			},
			{ timeout: 10_000 },
		)
		const next = engineWorker({ project })
		await next.control.request({ message: openMessage({ project }), expect: 'opened' })
		const reader = await clientOf({ control: next.control, clientId: 'c-2' })
		const readerDocuments = await reader.getDocuments()
		expect(readerDocuments).toEqual([makeDocument()])
		const readerWriteOutcome = await reader.getWriteOutcome({ writeId: 'w-stranded' })
		expect(readerWriteOutcome).toBe('not-applied')
	})
})

describe('an engine worker whose database close throws', () => {
	/** An engine open on the project in the close-throws fixture, a document written, the next close ordered to throw. */
	async function engineWhoseCloseThrows(params: { project: string }): Promise<{
		control: ReturnType<typeof startEngineWorker>['control']
	}> {
		const { control } = engineWorker({
			project: params.project,
			url: fixtureUrl({ scenario: 'close-throws' }),
		})
		await control.request({ message: openMessage(params), expect: 'opened' })
		const writer = await clientOf({ control, clientId: 'writer' })
		await writer.registerDocument(makeDocument())
		await orderFixture({ order: { type: 'close-throws' } })
		return { control }
	}

	it('destroyed → the destroy refused with the close’s error, the engine lock released all the same', async () => {
		const project = uniqueProject()
		const { control } = await engineWhoseCloseThrows({ project })
		const destroying = control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'if-available',
				budgetMs: 5_000,
			},
			expect: 'destroyed',
		})
		const refused = await rejectionKey({ action: destroying })
		expect(refused).toMatch(/the database would not close/)
		const free = await isEngineLockFree({ project })
		expect(free).toBe(true)
	})

	it('destroyed (refused), then opened again in the same worker → opened, its document there', async () => {
		const project = uniqueProject()
		const { control } = await engineWhoseCloseThrows({ project })
		const destroying = control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'if-available',
				budgetMs: 5_000,
			},
			expect: 'destroyed',
		})
		await rejectionKey({ action: destroying })
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const reader = await clientOf({ control, clientId: 'reader' })
		const documents = await reader.getDocuments()
		expect(documents).toEqual([makeDocument()])
	})

	it('closed, then opened again in the same worker → opened, its document there', async () => {
		const project = uniqueProject()
		const { control } = await engineWhoseCloseThrows({ project })
		const closing = control.request({ message: { type: 'close' }, expect: 'closed' })
		const refused = await rejectionKey({ action: closing })
		expect(refused).toMatch(/the database would not close/)
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const reader = await clientOf({ control, clientId: 'reader' })
		const documents = await reader.getDocuments()
		expect(documents).toEqual([makeDocument()])
	})
})

describe('a view coming back to its project (the creation id it knows)', () => {
	it('the project there with that id → opened; destroyed meanwhile → refused PROJECT_DESTROYED_WHILE_AWAY, nothing made; made again since → refused, its files as they were', async () => {
		const project = uniqueProject()
		const first = engineWorker({ project })
		const opened = await first.control.request({
			message: openMessage({ project }),
			expect: 'opened',
		})
		await first.control.request({ message: { type: 'close' }, expect: 'closed' })
		first.end()
		const again = engineWorker({ project })
		const reopened = await again.control.request({
			message: { ...openMessage({ project }), expectedCreationId: opened.creationId },
			expect: 'opened',
		})
		expect(reopened.creationId).toBe(opened.creationId)
		await again.control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'wait',
				budgetMs: 5_000,
			},
			expect: 'destroyed',
		})
		const away = engineWorker({ project })
		const awayControlRequestRefusalKey = await rejectionKey({
			action: away.control.request({
				message: { ...openMessage({ project }), expectedCreationId: opened.creationId },
				expect: 'opened',
			}),
		})
		expect(awayControlRequestRefusalKey).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
		// another tab makes the project again under its name
		await closedPoolWithDocument({ project })
		const madeAgain = await poolFileDigests({ project })
		const back = engineWorker({ project })
		const backControlRequestRefusalKey = await rejectionKey({
			action: back.control.request({
				message: { ...openMessage({ project }), expectedCreationId: opened.creationId },
				expect: 'opened',
			}),
		})
		expect(backControlRequestRefusalKey).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		const fileDigests = await poolFileDigests({ project })
		expect(fileDigests).toEqual(madeAgain)
		const lockFree = await isEngineLockFree({ project })
		expect(lockFree).toBe(true)
	})
})

describe('two dialectes, one project name', () => {
	/** The engine of the other dialecte on `project`, its pool removed after the case. */
	function otherEngineWorker(params: { project: string }): ReturnType<typeof startEngineWorker> {
		const started = startEngineWorker({ url: fixtureUrl({ scenario: 'other-dialecte' }) })
		cleanups.push(started.end, () =>
			removePoolDirectory({
				project: params.project,
				dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
			}),
		)
		return started
	}

	it('each dialecte’s engine opens its own project at once: two directories, two locks, documents apart', async () => {
		const project = uniqueProject()
		const ours = engineWorker({ project })
		const theirs = otherEngineWorker({ project })
		await ours.control.request({ message: openMessage({ project }), expect: 'opened' })
		await theirs.control.request({
			message: openMessage({ project, ...OTHER_FIXTURE_DIALECTE }),
			expect: 'opened',
		})
		const ourEngine = await clientOf({ control: ours.control, clientId: 'ours' })
		const theirEngine = await clientOf({ control: theirs.control, clientId: 'theirs' })
		await ourEngine.registerDocument(makeDocument({ id: 'ours' }))
		const theirDocuments = await theirEngine.getDocuments()
		expect(theirDocuments).toEqual([])
		const poolStatus = await poolState({ project })
		expect(poolStatus).toMatchObject({ exists: true })
		const otherDialectePoolStatus = await poolState({
			project,
			dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
		})
		expect(otherDialectePoolStatus).toMatchObject({ exists: true })
	})

	it('an open asking another dialecte than the engine’s → PROJECT_DIALECTE_MISMATCH naming both, no lock taken, nothing created', async () => {
		const project = uniqueProject()
		const { control } = otherEngineWorker({ project })
		const refused = await control
			.request({ message: openMessage({ project }), expect: 'opened' })
			.catch(function refusedWith(thrown: unknown) {
				return toDialecteError(thrown)
			})
		expect(refused).toMatchObject({ key: 'PROJECT_DIALECTE_MISMATCH' })
		expect(refused).toHaveProperty('meta', {
			project,
			realmDialecteId: FIXTURE_DIALECTE.dialecteId,
			engineDialecteIds: [OTHER_FIXTURE_DIALECTE.dialecteId],
		})
		const otherDialecteLockFree = await isEngineLockFree({
			project,
			dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
		})
		expect(otherDialecteLockFree).toBe(true)
		const lockFree = await isEngineLockFree({ project })
		expect(lockFree).toBe(true)
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
		const otherDialectePoolStatus = await poolState({
			project,
			dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
		})
		expect(otherDialectePoolStatus).toEqual({
			exists: false,
			files: 0,
		})
	})

	it('an open asking another version of the engine’s dialecte → PROJECT_DIALECTE_VERSION_MISMATCH, nothing created', async () => {
		const project = uniqueProject()
		const { control } = engineWorker({ project })
		const refused = await control
			.request({ message: openMessage({ project, dialecteVersion: '9.9.9' }), expect: 'opened' })
			.catch(function refusedWith(thrown: unknown) {
				return toDialecteError(thrown)
			})
		expect(refused).toMatchObject({
			key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
			meta: { engineVersion: FIXTURE_DIALECTE.dialecteVersion, realmVersion: '9.9.9' },
		})
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	})

	it('a destroy asking another dialecte → PROJECT_DIALECTE_MISMATCH, the project of that name kept', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const { control } = otherEngineWorker({ project })
		const controlRequestRefusalKey = await rejectionKey({
			action: control.request({
				message: {
					type: 'destroy',
					project,
					dialecteId: FIXTURE_DIALECTE.dialecteId,
					lock: 'if-available',
					budgetMs: 5_000,
				},
				expect: 'destroyed',
			}),
		})
		expect(controlRequestRefusalKey).toBe('PROJECT_DIALECTE_MISMATCH')
		const poolStatus = await poolState({ project })
		expect(poolStatus).toMatchObject({ exists: true })
	})
})

describe('an engine worker given two dialectes', () => {
	const { first, second } = TWO_DIALECTES_FIXTURE
	/** A dialecte of the worker: the source its own hooks say their diagnostics under, its config key and namespace. */
	const FIRST = {
		ref: first,
		source: CONTRACT_SESSION_DIAGNOSTICS.source,
		configKey: TEST_CONFIG_KEY,
		namespaceUri: TEST_DIALECTE_CONFIG.namespaces.default.uri,
	}
	const SECOND = {
		ref: second,
		source: SECOND_FIXTURE_DIAGNOSTICS.source,
		configKey: SECOND_FIXTURE_CONFIG.key,
		namespaceUri: SECOND_FIXTURE_CONFIG.namespaceUri,
	}
	const ungiven: FixtureDialecteRef = {
		dialecteId: UNGIVEN_FIXTURE_DIALECTE_ID,
		dialecteVersion: first.dialecteVersion,
	}
	/** Both orders, so a worker that serves one of them first only is told apart from one that serves both. */
	const IN_BOTH_ORDERS = {
		'the first dialecte, then the second': [FIRST, SECOND],
		'the second dialecte, then the first': [SECOND, FIRST],
	}
	/** A: the dialecte a worker served, B: another one given to it - in both directions. */
	const SERVED_THEN_OTHER = {
		'A is the first dialecte, B the second': { served: first, other: second },
		'A is the second dialecte, B the first': { served: second, other: first },
	}

	type Worker = ReturnType<typeof startEngineWorker>

	/** An instance of the worker file given both; ended after the case, the pools of `project` under both removed. */
	function twoDialectesWorker(params: {
		project: string
		scenario?: RuntimeFixtureScenario
	}): Worker {
		const started = startEngineWorker({
			url: fixtureUrl({ scenario: params.scenario ?? 'two-dialectes' }),
		})
		cleanups.push(started.end)
		for (const { dialecteId } of [first, second]) {
			cleanups.push(() => removePoolDirectory({ project: params.project, dialecteId }))
		}
		return started
	}

	function refusedWith(thrown: unknown): ReturnType<typeof toDialecteError> {
		return toDialecteError(thrown)
	}

	/** The answer to an open of `project` as `asked`, or the error that refused it. */
	function openAs(params: {
		control: Worker['control']
		project: string
		asked: FixtureDialecteRef
	}) {
		const { control, project, asked } = params
		return control
			.request({ message: openMessage({ project, ...asked }), expect: 'opened' })
			.catch(refusedWith)
	}

	/** The answer to a destroy of `project` as `asked`, or the error that refused it. */
	function destroyAs(params: {
		control: Worker['control']
		project: string
		asked: FixtureDialecteRef
	}) {
		const { control, project, asked } = params
		return control
			.request({
				message: {
					type: 'destroy',
					project,
					dialecteId: asked.dialecteId,
					lock: 'if-available',
					budgetMs: 5_000,
				},
				expect: 'destroyed',
			})
			.catch(refusedWith)
	}

	/** The project's engine lock under that dialecte held by the page until the returned release (or the case's end). */
	async function holdLockOf(params: { project: string; dialecteId: string }): Promise<() => void> {
		const release = await holdEngineLock(params)
		cleanups.push(release)
		return release
	}

	/** A worker opened `project` as `served` and stored a document in it, its engine left open. */
	async function openAsServed(params: {
		project: string
		served: FixtureDialecteRef
	}): Promise<{ started: Worker; engine: EngineApi }> {
		const { project, served } = params
		const started = twoDialectesWorker({ project })
		const opened = await openAs({ control: started.control, project, asked: served })
		expect(opened).toMatchObject({ type: 'opened', dialecteId: served.dialecteId })
		const engine = await clientOf({ control: started.control, clientId: 'writer' })
		await engine.registerDocument(makeDocument({ id: served.dialecteId }))
		return { started, engine }
	}

	/** A worker opened `project` as `served`, stored a document in it and closed: its pool paused in that worker. */
	async function closedAsServed(params: {
		project: string
		served: FixtureDialecteRef
	}): Promise<Worker> {
		const { started } = await openAsServed(params)
		await started.control.request({ message: { type: 'close' }, expect: 'closed' })
		return started
	}

	/** No lock taken and no file made for the project under that dialecte. */
	async function expectNothingMade(params: { project: string; dialecteId: string }): Promise<void> {
		await vi.waitFor(
			async function lockFree() {
				const lockFree = await isEngineLockFree(params)
				expect(lockFree).toBe(true)
			},
			{ timeout: LOCK_QUEUE_TIMEOUT_MS },
		)
		const poolStatus = await poolState(params)
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	}

	/** `served`'s project in the worker read again: opened again from its paused pool, its document there. */
	async function expectServedKept(params: {
		started: Worker
		project: string
		served: FixtureDialecteRef
	}): Promise<void> {
		const { started, project, served } = params
		const openReply = await openAs({ control: started.control, project, asked: served })
		expect(openReply).toMatchObject({
			type: 'opened',
			resumed: true,
		})
		const reader = await clientOf({ control: started.control, clientId: 'reader' })
		const readerDocuments = await reader.getDocuments()
		expect(readerDocuments).toEqual([makeDocument({ id: served.dialecteId })])
	}

	it.each(Object.entries(IN_BOTH_ORDERS))(
		'a worker each, asked for %s → a project of each opened, each answer naming the dialecte asked, each running its own hooks and config',
		async (_order, asks) => {
			const project = uniqueProject()
			for (const { ref, source, configKey, namespaceUri } of asks) {
				const { control } = twoDialectesWorker({ project })
				const openReply = await openAs({ control, project, asked: ref })
				expect(openReply).toMatchObject({
					type: 'opened',
					dialecteId: ref.dialecteId,
					dialecteVersion: ref.dialecteVersion,
				})
				const engine = await clientOf({ control, clientId: 'importer' })
				const imported = await engine.importFile({
					file: fixtureFile({ namespaceUri, body: sessionRecords(1) }),
					writeId: 'w-hooks',
				})
				// its hooks, its default config key, then its namespace written back by an export
				expect(imported.diagnostics.map((diagnostic) => diagnostic.source)).toEqual([source])
				expect(imported.record.configKey).toBe(configKey)
				const exported = await engine.exportFile({
					documentId: imported.record.id,
					exportId: 'e-config',
				})
				const exportedFileText = await exported.file.text()
				expect(exportedFileText).toContain(`xmlns="${namespaceUri}"`)
			}
			for (const { ref } of asks) {
				const poolStatus = await poolState({ project, dialecteId: ref.dialecteId })
				expect(poolStatus).toMatchObject({
					exists: true,
				})
			}
		},
	)

	it.each(['open', 'destroy'] as const)(
		'a dialecte it was not given, asked to %s while its lock is held elsewhere → failed PROJECT_DIALECTE_MISMATCH naming the ids given, not PROJECT_OPEN_ELSEWHERE; no file; the next message answered',
		async (verb) => {
			const project = uniqueProject()
			const { control } = twoDialectesWorker({ project })
			const release = await holdLockOf({ project, dialecteId: ungiven.dialecteId })
			const refused =
				verb === 'open'
					? await openAs({ control, project, asked: ungiven })
					: await destroyAs({ control, project, asked: ungiven })
			expect(refused).toMatchObject({
				key: 'PROJECT_DIALECTE_MISMATCH',
				detail: expect.stringContaining(ungiven.dialecteId),
			})
			expect(refused).toMatchObject({ detail: expect.stringContaining(first.dialecteId) })
			expect(refused).toMatchObject({ detail: expect.stringContaining(second.dialecteId) })
			expect(refused).toHaveProperty('meta', {
				project,
				realmDialecteId: ungiven.dialecteId,
				engineDialecteIds: [first.dialecteId, second.dialecteId],
			})
			release()
			await expectNothingMade({ project, dialecteId: ungiven.dialecteId })
			const openReply = await openAs({ control, project, asked: second })
			expect(openReply).toMatchObject({
				type: 'opened',
				dialecteId: second.dialecteId,
			})
		},
	)

	it.each(Object.entries(IN_BOTH_ORDERS))(
		'a given dialecte asked at another version, %s → PROJECT_DIALECTE_VERSION_MISMATCH for each, nothing created',
		async (_order, asks) => {
			const project = uniqueProject()
			const { control } = twoDialectesWorker({ project })
			for (const { ref } of asks) {
				const asked = { dialecteId: ref.dialecteId, dialecteVersion: UNSERVED_DIALECTE_VERSION }
				const openReply = await openAs({ control, project, asked })
				expect(openReply).toMatchObject({
					key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
					meta: {
						project,
						dialecteId: ref.dialecteId,
						engineVersion: ref.dialecteVersion,
						realmVersion: UNSERVED_DIALECTE_VERSION,
					},
				})
				await expectNothingMade({ project, dialecteId: ref.dialecteId })
			}
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a worker that served (A, x), closed, asked to open (B, x) (%s), (B, x)’s lock held elsewhere → refused ASSERTION_FAILED, not PROJECT_OPEN_ELSEWHERE; A’s pool kept, (A, x) opens again with its data',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const started = await closedAsServed({ project, served })
			const digests = await poolFileDigests({ project, dialecteId: served.dialecteId })
			const release = await holdLockOf({ project, dialecteId: other.dialecteId })
			const openReply = await openAs({ control: started.control, project, asked: other })
			expect(openReply).toMatchObject({
				key: 'ASSERTION_FAILED',
			})
			release()
			await expectNothingMade({ project, dialecteId: other.dialecteId })
			const fileDigests = await poolFileDigests({ project, dialecteId: served.dialecteId })
			expect(fileDigests).toEqual(digests)
			await expectServedKept({ started, project, served })
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a worker that served (A, x), closed, asked to destroy (B, x) (%s), (B, x)’s lock held elsewhere → refused ASSERTION_FAILED, not PROJECT_OPEN_ELSEWHERE; nothing of B, A’s project kept: reopened (resumed), its data read',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const started = await closedAsServed({ project, served })
			const digests = await poolFileDigests({ project, dialecteId: served.dialecteId })
			const release = await holdLockOf({ project, dialecteId: other.dialecteId })
			const destroyReply = await destroyAs({ control: started.control, project, asked: other })
			expect(destroyReply).toMatchObject({
				key: 'ASSERTION_FAILED',
			})
			release()
			await expectNothingMade({ project, dialecteId: other.dialecteId })
			const fileDigests = await poolFileDigests({ project, dialecteId: served.dialecteId })
			expect(fileDigests).toEqual(digests)
			await expectServedKept({ started, project, served })
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a worker holding (A, x) paused, asked to destroy (A, y), destroy (B, y) and open (A, y) (%s) → each refused ASSERTION_FAILED, x’s data read back',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const otherProject = uniqueProject()
			cleanups.push(() =>
				removePoolDirectory({ project: otherProject, dialecteId: served.dialecteId }),
			)
			const started = await closedAsServed({ project, served })
			const { control } = started
			const servedDestroyReply = await destroyAs({ control, project: otherProject, asked: served })
			expect(servedDestroyReply).toMatchObject({
				key: 'ASSERTION_FAILED',
			})
			const otherDestroyReply = await destroyAs({ control, project: otherProject, asked: other })
			expect(otherDestroyReply).toMatchObject({
				key: 'ASSERTION_FAILED',
			})
			const openReply = await openAs({ control, project: otherProject, asked: served })
			expect(openReply).toMatchObject({
				key: 'ASSERTION_FAILED',
			})
			await expectServedKept({ started, project, served })
		},
	)

	it.each([
		['destroy (B, x), A the first dialecte', { served: first, asked: second, sameProject: true }],
		['destroy (B, x), A the second dialecte', { served: second, asked: first, sameProject: true }],
		['destroy (A, y), A the first dialecte', { served: first, asked: first, sameProject: false }],
		[
			'destroy (A, y), A the second dialecte',
			{ served: second, asked: second, sameProject: false },
		],
	] as const)(
		'a worker whose engine for (A, x) is still open, asked to %s → refused ASSERTION_FAILED, A’s client still reads its document',
		async (_case, { served, asked, sameProject }) => {
			const project = uniqueProject()
			const askedProject = sameProject ? project : uniqueProject()
			cleanups.push(() =>
				removePoolDirectory({ project: askedProject, dialecteId: asked.dialecteId }),
			)
			const { started, engine } = await openAsServed({ project, served })
			const destroyReply = await destroyAs({
				control: started.control,
				project: askedProject,
				asked,
			})
			expect(destroyReply).toMatchObject({ key: 'ASSERTION_FAILED' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([makeDocument({ id: served.dialecteId })])
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a worker that served (A, x) and destroyed it, asked to open (B, x) (%s) → opened: the project served is forgotten',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const { control } = await closedAsServed({ project, served })
			const destroyReply = await destroyAs({ control, project, asked: served })
			expect(destroyReply).toMatchObject({
				type: 'destroyed',
			})
			const openReply = await openAs({ control, project, asked: other })
			expect(openReply).toMatchObject({
				type: 'opened',
				dialecteId: other.dialecteId,
			})
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a fresh worker whose open of (A, x) was refused for its lock held elsewhere (%s), asked to open (B, x) → opened: a refused open serves nothing',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const { control } = twoDialectesWorker({ project })
			const release = await holdLockOf({ project, dialecteId: served.dialecteId })
			const refusedOpenReply = await openAs({ control, project, asked: served })
			expect(refusedOpenReply).toMatchObject({
				key: 'PROJECT_OPEN_ELSEWHERE',
			})
			release()
			const otherOpenReply = await openAs({ control, project, asked: other })
			expect(otherOpenReply).toMatchObject({
				type: 'opened',
				dialecteId: other.dialecteId,
			})
		},
	)

	it.each(Object.entries(SERVED_THEN_OTHER))(
		'a fresh worker that destroyed (B, x), asked to open (A, x) in the same instance (%s) → opened: a destroy serves nothing',
		async (_case, { served, other }) => {
			const project = uniqueProject()
			const holder = await closedAsServed({ project, served: other })
			holder.end()
			const { control } = twoDialectesWorker({ project })
			const destroyReply = await destroyAs({ control, project, asked: other })
			expect(destroyReply).toMatchObject({
				type: 'destroyed',
			})
			const openReply = await openAs({ control, project, asked: served })
			expect(openReply).toMatchObject({
				type: 'opened',
				dialecteId: served.dialecteId,
			})
		},
	)

	it.each([
		['A is the first dialecte, B the second', { destroyed: second, kept: first }],
		['A is the second dialecte, B the first', { destroyed: first, kept: second }],
	] as const)(
		'a fresh worker asked to destroy (B, x), A and B each holding a project x (%s) → B’s files removed, A’s project kept',
		async (_case, { destroyed, kept }) => {
			const project = uniqueProject()
			for (const served of [first, second]) {
				const holder = await closedAsServed({ project, served })
				holder.end()
			}
			const fresh = twoDialectesWorker({ project })
			const destroyReply = await destroyAs({ control: fresh.control, project, asked: destroyed })
			expect(destroyReply).toMatchObject({
				type: 'destroyed',
			})
			const destroyedPoolStatus = await poolState({ project, dialecteId: destroyed.dialecteId })
			expect(destroyedPoolStatus).toEqual({
				exists: false,
				files: 0,
			})
			const keptPoolStatus = await poolState({ project, dialecteId: kept.dialecteId })
			expect(keptPoolStatus).toMatchObject({
				exists: true,
			})
			const reader = twoDialectesWorker({ project })
			const openReply = await openAs({ control: reader.control, project, asked: kept })
			expect(openReply).toMatchObject({
				type: 'opened',
			})
			const engine = await clientOf({ control: reader.control, clientId: 'reader' })
			const engineDocuments = await engine.getDocuments()
			expect(engineDocuments).toEqual([makeDocument({ id: kept.dialecteId })])
		},
	)

	it('a list holding one id twice, with another dialecte between → the first declaration of the id served: its hooks, its version accepted, the other version refused PROJECT_DIALECTE_VERSION_MISMATCH; the other dialecte served too', async () => {
		const project = uniqueProject()
		const scenario = 'same-id-twice'
		const { control } = twoDialectesWorker({ project, scenario })
		const firstOpenReply = await openAs({ control, project, asked: first })
		expect(firstOpenReply).toMatchObject({
			type: 'opened',
			dialecteVersion: first.dialecteVersion,
		})
		const engine = await clientOf({ control, clientId: 'importer' })
		const imported = await engine.importFile({
			file: fixtureFile({ namespaceUri: FIRST.namespaceUri, body: sessionRecords(1) }),
			writeId: 'w-first-found',
		})
		expect(imported.diagnostics.map((diagnostic) => diagnostic.source)).toEqual([FIRST.source])
		const repeated = {
			dialecteId: first.dialecteId,
			dialecteVersion: REPEATED_FIXTURE.dialecteVersion,
		}
		const refusing = twoDialectesWorker({ project, scenario })
		const repeatedOpenReply = await openAs({ control: refusing.control, project, asked: repeated })
		expect(repeatedOpenReply).toMatchObject({
			key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
			meta: { dialecteId: first.dialecteId, engineVersion: first.dialecteVersion },
		})
		const besides = twoDialectesWorker({ project, scenario })
		const secondOpenReply = await openAs({ control: besides.control, project, asked: second })
		expect(secondOpenReply).toMatchObject({
			type: 'opened',
			dialecteId: second.dialecteId,
		})
	})
})

describe('an engine worker destroying its project', () => {
	it('through a store → the pool directory gone; a new connection reads empty', async () => {
		const name = uniqueProject()
		cleanups.push(() => removePoolDirectory({ project: name }))
		async function open() {
			const store = new EngineStore({
				name,
				connector: createSqliteWorkerConnector({
					...FIXTURE_DIALECTE,
					name,
					engineUrl: TEST_ENGINE_URL,
				}),
			})
			await store.open()
			return store
		}
		const store = await open()
		await store.registerDocument(makeDocument())
		await store.destroy()
		const poolStatus = await poolState({ project: name })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
		const next = await open()
		const nextDocuments = await next.getDocuments()
		expect(nextDocuments).toEqual([])
		await next.destroy()
	})

	it('with no engine open in the worker → the pool directory gone', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const { control } = engineWorker({ project })
		await control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'if-available',
				budgetMs: 1_000,
			},
			expect: 'destroyed',
		})
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	})

	it.each(['', '.', '..'])(
		'a project named %j, its engine lock held elsewhere → refused PROJECT_NAME_INVALID: the name is refused before the lock is asked',
		async (project) => {
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const started = startEngineWorker({})
			cleanups.push(started.end)
			const refused = await rejectionKey({
				action: started.control.request({
					message: {
						type: 'destroy',
						project,
						dialecteId: FIXTURE_DIALECTE.dialecteId,
						lock: 'if-available',
						budgetMs: 1_000,
					},
					expect: 'destroyed',
				}),
			})
			expect(refused).toBe('PROJECT_NAME_INVALID')
		},
	)

	it('a pool file another worker holds a moment (as a worker just ended does) → the removal retried within the budget, the directory gone', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const holder = await holdPoolFile({ project })
		cleanups.push(holder.release)
		const { control } = engineWorker({ project })
		const destroying = control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'if-available',
				budgetMs: 5_000,
			},
			expect: 'destroyed',
		})
		setTimeout(function letGo() {
			void holder.release()
		}, 300)
		await destroying
		const poolStatus = await poolState({ project })
		expect(poolStatus).toEqual({ exists: false, files: 0 })
	})

	it('a pool file another worker holds → PROJECT_DESTROY_FAILED, the directory still there', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const holder = await holdPoolFile({ project })
		cleanups.push(holder.release)
		const { control } = engineWorker({ project })
		const controlRequestRefusalKey = await rejectionKey({
			action: control.request({
				message: {
					type: 'destroy',
					project,
					dialecteId: FIXTURE_DIALECTE.dialecteId,
					lock: 'if-available',
					budgetMs: 1_000,
				},
				expect: 'destroyed',
			}),
		})
		expect(controlRequestRefusalKey).toBe('PROJECT_DESTROY_FAILED')
		const poolStatus = await poolState({ project })
		expect(poolStatus.exists).toBe(true)
	})
})

describe('a client of an engine worker', () => {
	it('released during its own held import → the import aborted in the engine: not applied, nothing of the file', async () => {
		const name = uniqueProject()
		const engineUrl = CONTRACT_ENGINE_URL
		const connector = createSqliteWorkerConnector({ ...FIXTURE_DIALECTE, name, engineUrl })
		cleanups.push(() => connector.destroy())
		const link = await connector.connect()
		const engine = await link.engine()
		const hold = holdContractImport()
		cleanups.push(hold.release)
		const importing = engine.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		await untilHeld({ hold, importing })
		const other = await connector.connect()
		const reader = await other.engine()
		await reader.registerDocument(makeDocument({ id: 'kept' }))
		link.close()
		// the released connection's own call ends: refused, never left waiting
		const importingRefusalKey = await rejectionKey({ action: importing })
		expect(importingRefusalKey).toBe('STORE_CLOSED')
		hold.release()
		await expect
			.poll(() => reader.getWriteOutcome({ writeId: 'w-held' }), { timeout: 5_000 })
			.toBe('not-applied')
		const readerDocuments = await reader.getDocuments()
		expect(readerDocuments).toEqual([makeDocument({ id: 'kept' })])
		other.close()
	})
})
