import { CONTRACT_ENGINE_URL } from '../../contract/store-contract.constants'
import { contractFile, makeDocument, makeRecord } from '../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../contract/store-contract.import-session'
import { EngineStore } from '../../engine/engine-store'
import { ENGINE_LOCK_PREFIX } from '../../engine/engine.constants'
import { POOL_CAPACITY } from './runtime.constants'
import {
	TEST_ENGINE_URL,
	clientOf,
	fixtureUrl,
	holdPoolFile,
	openMessage,
	poolState,
	removePoolDirectory,
	startEngineWorker,
	uniqueProject,
} from './runtime.fixtures'
import {
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	RUNTIME_FIXTURE_CHANNEL,
} from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'

import type { RuntimeFixtureNotice, RuntimeFixtureOrder } from './runtime.fixtures.types'

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

/** The key of what a promise rejected with; `resolved` when it did not. */
async function rejectionKey(params: { action: Promise<unknown> }): Promise<string> {
	try {
		await params.action
		return 'resolved'
	} catch (thrown) {
		return toDialecteError(thrown)?.key ?? String(thrown)
	}
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
		/** The project's engine lock held by the page until the returned release. */
		async function holdLock(params: { project: string }): Promise<() => void> {
			let release: () => void = () => {}
			await new Promise<void>((granted) => {
				void navigator.locks.request(`${ENGINE_LOCK_PREFIX}${params.project}`, async () => {
					granted()
					await new Promise<void>((done) => {
						release = done
					})
				})
			})
			return release
		}

		it('taken only if free → PROJECT_OPEN_ELSEWHERE without waiting, nothing created', async () => {
			const project = uniqueProject()
			const release = await holdLock({ project })
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
			const release = await holdLock({ project })
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
		async function orderDisk(order: RuntimeFixtureOrder): Promise<void> {
			const listener = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
			const acknowledged = new Promise<void>(function waitForAck(resolve) {
				listener.addEventListener(
					'message',
					function hear(event: MessageEvent<RuntimeFixtureNotice>) {
						if (event.data.type === 'ack' && event.data.of === order.type) resolve()
					},
				)
			})
			const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
			channel.postMessage(order)
			channel.close()
			await acknowledged
			listener.close()
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

	it('a pool that fails to get ready (its files cannot be opened, none held elsewhere) → refused, the pool kept: a later engine finds its document', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const broken = engineWorker({ project, url: fixtureUrl({ scenario: 'install-fails' }) })
		const refused = await broken.control
			.request({ message: openMessage({ project }), expect: 'opened' })
			.then(
				() => 'opened',
				() => 'refused',
			)
		expect(refused).toBe('refused')
		broken.end()
		const { control } = engineWorker({ project })
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'reader' })
		expect(await engine.getDocuments()).toEqual([makeDocument()])
	})

	it('a pool that failed to get ready, opened again in the same worker → installed this time, its document there', async () => {
		const project = uniqueProject()
		await closedPoolWithDocument({ project })
		const { control } = engineWorker({
			project,
			url: fixtureUrl({ scenario: 'install-fails-once' }),
		})
		const first = await control
			.request({ message: openMessage({ project }), expect: 'opened' })
			.then(
				() => 'opened',
				() => 'refused',
			)
		expect(first).toBe('refused')
		await control.request({ message: openMessage({ project }), expect: 'opened' })
		const engine = await clientOf({ control, clientId: 'reader' })
		expect(await engine.getDocuments()).toEqual([makeDocument()])
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

describe('an engine worker destroying its project', () => {
	it('through a store → the pool directory gone; a new connection reads empty', async () => {
		const name = uniqueProject()
		cleanups.push(() => removePoolDirectory({ project: name }))
		const open = async () => {
			const store = new EngineStore({
				name,
				connector: createSqliteWorkerConnector({ name, engineUrl: TEST_ENGINE_URL }),
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
			message: { type: 'destroy', project, lock: 'if-available', budgetMs: 1_000 },
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
			message: { type: 'destroy', project, lock: 'if-available', budgetMs: 5_000 },
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
					message: { type: 'destroy', project, lock: 'if-available', budgetMs: 1_000 },
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
		const connector = createSqliteWorkerConnector({ name, engineUrl })
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
