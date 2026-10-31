import { CONTRACT_ENGINE_URL } from '../../contract/store-contract.constants'
import { contractFile, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../contract/store-contract.import-session'
import { EngineStore } from '../../engine/engine-store'
import { POOL_CAPACITY } from './runtime.constants'
import {
	TEST_ENGINE_URL,
	clientOf,
	damageDatabaseHeader,
	engineLockQueue,
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
	UNSAFE_POOL_SQLITE,
} from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { rejectionKey } from '@/errors/errors.fixtures'
import { Project } from '@/project/project'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { RuntimeFixtureOrder, RuntimeFixtureScenario } from './runtime.fixtures.types'
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
		expect(
			await rejectionKey({
				action: control.request({ message: openMessage({ project }), expect: 'opened' }),
			}),
		).toBe('STORE_UNAVAILABLE')
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
	})

	describe('the project’s engine lock held elsewhere', () => {
		it('taken only if free → PROJECT_OPEN_ELSEWHERE without waiting, nothing created', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project })
			const budgetMs = 10_000
			const startedAt = performance.now()
			expect(
				await rejectionKey({
					action: control.request({
						message: openMessage({ project, budgetMs }),
						expect: 'opened',
					}),
				}),
			).toBe('PROJECT_OPEN_ELSEWHERE')
			// a wait for the lock would last the whole budget; the worker's own start (its SQLite load) counts here too
			expect(performance.now() - startedAt).toBeLessThan(budgetMs)
			expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
		})

		it('waited for within 300 ms → PROJECT_ENGINE_BUSY once they have passed', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project })
			const startedAt = performance.now()
			expect(
				await rejectionKey({
					action: control.request({
						message: openMessage({ project, lock: 'wait', budgetMs: 300 }),
						expect: 'opened',
					}),
				}),
			).toBe('PROJECT_ENGINE_BUSY')
			expect(performance.now() - startedAt).toBeGreaterThanOrEqual(290)
		})

		it('held by another engine worker → PROJECT_OPEN_ELSEWHERE; that engine goes on', async () => {
			const project = uniqueProject()
			const first = engineWorker({ project })
			await first.control.request({ message: openMessage({ project }), expect: 'opened' })
			const second = engineWorker({ project })
			expect(
				await rejectionKey({
					action: second.control.request({ message: openMessage({ project }), expect: 'opened' }),
				}),
			).toBe('PROJECT_OPEN_ELSEWHERE')
			const engine = await clientOf({ control: first.control, clientId: 'c-1' })
			expect(await engine.getDocuments()).toEqual([])
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
		expect(await poolState({ project })).toEqual({ exists: true, files: POOL_CAPACITY })
		await holder.release()
		const next = engineWorker({ project })
		await next.control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control: next.control, clientId: 'reader' })
		expect(await engine.getDocuments()).toEqual([makeDocument()])
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
			expect(await isEngineLockFree({ project })).toBe(true)
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
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
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
		expect(
			await rejectionKey({
				action: engine.importFile({
					file: contractFile({ body: body.join('') }),
					writeId: 'w-big',
				}),
			}),
		).toBe('STORE_QUOTA_EXCEEDED')
		expect(await engine.getDocuments()).toEqual([])
		expect(await engine.getWriteOutcome({ writeId: 'w-big' })).toBe('not-applied')
	})

	describe('the origin out of storage while it writes (the file system refuses the writes)', () => {
		/** An engine on the `disk-full` fixture, a document registered, then the disk filled (after some writes). */
		async function engineOnFullDisk(
			params: { afterWrites?: number; failing?: boolean } = {},
		): Promise<Awaited<ReturnType<typeof clientOf>>> {
			const project = uniqueProject()
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'disk-full' }) })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'c-1' })
			await engine.registerDocument(makeDocument())
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
			expect(
				await rejectionKey({
					action: engine.commit({
						documentId: 'doc-1',
						writeId: 'w-1',
						creates,
						updates: [],
						deletes: [],
					}),
				}),
			).toBe('STORE_QUOTA_EXCEEDED')
			expect(await engine.count('doc-1')).toBe(0)
		})

		it('a commit refused by the file system for another reason while room is left → its own key, STORE_COMMIT_FAILED', async () => {
			const engine = await engineOnFullDisk({ failing: true })
			const creates = Array.from({ length: 2_000 }, (_, index) => makeRecord({ id: `r${index}` }))
			expect(
				await rejectionKey({
					action: engine.commit({
						documentId: 'doc-1',
						writeId: 'w-1',
						creates,
						updates: [],
						deletes: [],
					}),
				}),
			).toBe('STORE_COMMIT_FAILED')
		})

		it('an import, the disk filling once it has started writing → STORE_QUOTA_EXCEEDED, nothing registered', async () => {
			const engine = await engineOnFullDisk({ afterWrites: 20 })
			const body = Array.from({ length: 5_000 }, (_, index) => `<A aA="${index}"/>`).join('')
			expect(
				await rejectionKey({
					action: engine.importFile({ file: contractFile({ body }), writeId: 'w-import' }),
				}),
			).toBe('STORE_QUOTA_EXCEEDED')
			// the disk full, SQLite cannot even roll back what it began: the aftermath is read once there is room
			await orderDisk({ type: 'disk-free' })
			expect(await engine.getWriteOutcome({ writeId: 'w-import' })).toBe('not-applied')
			expect(await engine.getDocument('doc-1')).toEqual(makeDocument())
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
				expect(
					await rejectionKey({
						action: broken.control.request({ message: openMessage({ project }), expect: 'opened' }),
					}),
				).toBe(INSTALL_REFUSAL.text)
				expect(await poolFileDigests({ project })).toEqual(written)
				broken.end()
				const { control } = engineWorker({ project })
				await control.request({ message: openMessage({ project }), expect: 'opened' })
				const engine = await clientOf({ control, clientId: 'reader' })
				expect(await engine.getDocuments()).toEqual([makeDocument()])
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
				expect(await refused).toBe(INSTALL_REFUSAL.text)
				expect(await opened).toBe('opened')
				const engine = await clientOf({ control: reader.control, clientId: 'reader' })
				expect(await engine.getDocuments()).toEqual([makeDocument()])
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
		expect(
			await rejectionKey({
				action: control.request({ message: openMessage({ project }), expect: 'opened' }),
			}),
		).toBe(INSTALL_REFUSAL.text)
		expect(await poolFileDigests({ project })).toEqual(written)
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'reader' })
		expect(await engine.getDocuments()).toEqual([makeDocument()])
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
			expect(await poolFileDigests({ project })).toEqual(written)
			const next = engineWorker({ project })
			await next.control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control: next.control, clientId: 'reader' })
			expect(await engine.getDocuments()).toEqual([makeDocument()])
		})

		it('its engine lock held elsewhere → ASSERTION_FAILED, not PROJECT_OPEN_ELSEWHERE: refused before the lock is asked', async () => {
			const project = uniqueProject()
			const release = await holdEngineLock({ project })
			cleanups.push(release)
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'sqlite-3-53' }) })
			expect(
				await rejectionKey({
					action: control.request({
						message: openMessage({ project, lock: 'if-available' }),
						expect: 'opened',
					}),
				}),
			).toBe('ASSERTION_FAILED')
		})

		it('a new project → ASSERTION_FAILED, nothing created', async () => {
			const project = uniqueProject()
			const { control } = engineWorker({ project, url: fixtureUrl({ scenario: 'sqlite-3-53' }) })
			expect(
				await rejectionKey({
					action: control.request({ message: openMessage({ project }), expect: 'opened' }),
				}),
			).toBe('ASSERTION_FAILED')
			expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
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
				expect(await poolFileDigests({ project })).toEqual(damaged)
				const next = engineWorker({ project })
				expect(
					await rejectionKey({
						action: next.control.request({ message: openMessage({ project }), expect: 'opened' }),
					}),
				).toBe('PROJECT_DATABASE_LOST')
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
			expect(await open()).toBe('PROJECT_DATABASE_LOST')
			expect(await poolFileDigests({ project })).toEqual(damaged)
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
			expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
			expect(await open()).toBe('resolved')
			const reader = await clientOf({ control, clientId: 'reader' })
			expect(await reader.getDocuments()).toEqual([])
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
			expect(await rejectionKey({ action: project.open(name) })).toBe('PROJECT_DATABASE_LOST')
			await project.destroy()
			expect(await poolState({ project: name })).toEqual({ exists: false, files: 0 })
			await project.open(name)
			expect(await project.getDocuments()).toEqual([])
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
			expect(toDialecteError(await reopening)).toMatchObject({
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
			expect(await open()).toBe('PROJECT_DATABASE_LOST')
			expect(await open()).toBe('PROJECT_DATABASE_LOST')
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
			expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
			expect(await open()).toBe('resolved')
			const engine = await clientOf({ control, clientId: 'reader' })
			expect(await engine.getDocuments()).toEqual([])
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
			expect(
				await rejectionKey({
					action: control.request({ message: openMessage({ project }), expect: 'opened' }),
				}),
			).toBe('STORE_QUOTA_EXCEEDED')
			expect(await poolFileDigests({ project })).toEqual(blank)
		})

		it.each(Object.entries(pools))('%s', async (_label, { sizes }) => {
			const project = uniqueProject()
			await makeBlankPool({ project, sizes })
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'writer' })
			expect(await engine.getDocuments()).toEqual([])
			await engine.registerDocument(makeDocument())
			expect(await engine.getDocuments()).toEqual([makeDocument()])
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
				expect(
					await rejectionKey({
						action: failing.control.request({
							message: openMessage({ project }),
							expect: 'opened',
						}),
					}),
				).toBe(refusal)
				failing.end()
				const { control } = engineWorker({ project })
				await control.request({ message: openMessage({ project }), expect: 'opened' })
				const engine = await clientOf({ control, clientId: 'reader' })
				expect(await engine.getDocuments()).toEqual([])
			},
		)

		it('the database cannot be opened, on a project with a document → refused, the pool kept byte for byte: the next engine reads it', async () => {
			const project = uniqueProject()
			await closedPoolWithDocument({ project })
			const written = await poolFileDigests({ project })
			expect(Object.keys(written)).toHaveLength(POOL_CAPACITY)
			const failing = engineWorker({ project, url: fixtureUrl({ scenario: 'database-fails' }) })
			expect(
				await rejectionKey({
					action: failing.control.request({ message: openMessage({ project }), expect: 'opened' }),
				}),
			).toBe(`Error: ${OPEN_FAILURE.database}`)
			expect(await poolFileDigests({ project })).toEqual(written)
			failing.end()
			const { control } = engineWorker({ project })
			await control.request({ message: openMessage({ project }), expect: 'opened' })
			const engine = await clientOf({ control, clientId: 'reader' })
			expect(await engine.getDocuments()).toEqual([makeDocument()])
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
		expect(await rejectionKey({ action: engine.importFile({ file, writeId: 'w-between' }) })).toBe(
			'STORE_QUOTA_EXCEEDED',
		)
		expect(await engine.getDocuments()).toEqual([])
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
		expect(await (await clientOf({ control, clientId: 'reader' })).getDocuments()).toEqual([
			makeDocument(),
		])
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
		expect(
			await rejectionKey({
				action: away.control.request({
					message: { ...openMessage({ project }), expectedCreationId: opened.creationId },
					expect: 'opened',
				}),
			}),
		).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
		// another tab makes the project again under its name
		await closedPoolWithDocument({ project })
		const madeAgain = await poolFileDigests({ project })
		const back = engineWorker({ project })
		expect(
			await rejectionKey({
				action: back.control.request({
					message: { ...openMessage({ project }), expectedCreationId: opened.creationId },
					expect: 'opened',
				}),
			}),
		).toBe('PROJECT_DESTROYED_WHILE_AWAY')
		expect(await poolFileDigests({ project })).toEqual(madeAgain)
		expect(await isEngineLockFree({ project })).toBe(true)
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
		expect(await poolState({ project })).toMatchObject({ exists: true })
		expect(
			await poolState({ project, dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId }),
		).toMatchObject({ exists: true })
	})

	it('an open asking another dialecte than the engine’s → PROJECT_DIALECTE_MISMATCH naming both, no lock taken, nothing created', async () => {
		const project = uniqueProject()
		const { control } = otherEngineWorker({ project })
		const refused = await control
			.request({ message: openMessage({ project }), expect: 'opened' })
			.catch(function refusedWith(thrown: unknown) {
				return toDialecteError(thrown)
			})
		expect(refused).toMatchObject({
			key: 'PROJECT_DIALECTE_MISMATCH',
			meta: {
				project,
				projectDialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
				realmDialecteId: FIXTURE_DIALECTE.dialecteId,
			},
		})
		expect(await isEngineLockFree({ project, dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId })).toBe(
			true,
		)
		expect(await isEngineLockFree({ project })).toBe(true)
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
		expect(await poolState({ project, dialecteId: OTHER_FIXTURE_DIALECTE.dialecteId })).toEqual({
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
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
	})

	it('a destroy asking another dialecte → PROJECT_DIALECTE_MISMATCH, the project of that name kept', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const { control } = otherEngineWorker({ project })
		expect(
			await rejectionKey({
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
			}),
		).toBe('PROJECT_DIALECTE_MISMATCH')
		expect(await poolState({ project })).toMatchObject({ exists: true })
	})
})

describe('an engine worker destroying its project', () => {
	it('through a store → the pool directory gone; a new connection reads empty', async () => {
		const name = uniqueProject()
		cleanups.push(() => removePoolDirectory({ project: name }))
		const open = async () => {
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
		expect(await poolState({ project: name })).toEqual({ exists: false, files: 0 })
		const next = await open()
		expect(await next.getDocuments()).toEqual([])
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
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
	})

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
		expect(await poolState({ project })).toEqual({ exists: false, files: 0 })
	})

	it('a pool file another worker holds → PROJECT_DESTROY_FAILED, the directory still there', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const holder = await holdPoolFile({ project })
		cleanups.push(holder.release)
		const { control } = engineWorker({ project })
		expect(
			await rejectionKey({
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
			}),
		).toBe('PROJECT_DESTROY_FAILED')
		expect((await poolState({ project })).exists).toBe(true)
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
		expect(await rejectionKey({ action: importing })).toBe('STORE_CLOSED')
		hold.release()
		await expect
			.poll(() => reader.getWriteOutcome({ writeId: 'w-held' }), { timeout: 5_000 })
			.toBe('not-applied')
		expect(await reader.getDocuments()).toEqual([makeDocument({ id: 'kept' })])
		other.close()
	})
})
