import {
	SMALL_BATCHES,
	contractFile,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { EngineStore } from '../served/engine-store'
import { fixtureUrl, removePoolDirectory, uniqueProject } from './runtime.fixtures'
import {
	FIXTURE_DIALECTE,
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	KEPT_ALIVE_TIMEOUT_MS,
	RUNTIME_FIXTURE_CHANNEL,
} from './runtime.fixtures.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'

import type { RuntimeFixtureNotice, RuntimeFixtureScenario } from './runtime.fixtures.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** What a case leaves: its stores closed, then destroyed, its pools removed. */
const cleanups: (() => Promise<void> | void)[] = []
/** The stores a case opened: all closed first, as a project is destroyed only once no other connection has it open. */
const stores: EngineStore[] = []

afterEach(async () => {
	for (const store of stores.splice(0)) store.close()
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** An open store of a project of its own on the fixture engine, its liveness timings given. */
async function openStore(params: {
	scenario?: RuntimeFixtureScenario
	heartbeatTimeoutMs: number
	name?: string
	progressBeatOps?: number
}): Promise<EngineStore> {
	const {
		scenario = 'liveness',
		heartbeatTimeoutMs,
		name = uniqueProject(),
		progressBeatOps,
	} = params
	const connector = createSqliteWorkerConnector({
		...FIXTURE_DIALECTE,
		name,
		engineUrl: fixtureUrl({ scenario }),
		liveness: { heartbeatTimeoutMs, heartbeatIntervalMs: 100 },
		progressBeatOps,
	})
	const store = new EngineStore({ name, connector })
	stores.push(store)
	await store.open()
	cleanups.push(
		() => store.destroy(),
		() => removePoolDirectory({ project: name }),
	)
	return store
}

/** A file of `markers.length` records of the session's tag, each carrying its `bB`. */
function markedFile(params: { markers: string[] }): File {
	return contractFile({
		body: params.markers.map((marker, index) => `<B aB="B${index}" bB="${marker}"/>`).join(''),
	})
}

/** What a call ended with: `resolved`, or the key and meta of its refusal. */
async function outcomeOf(action: Promise<unknown>): Promise<unknown> {
	try {
		await action
		return 'resolved'
	} catch (thrown) {
		const error = toDialecteError(thrown)
		return { key: error?.key ?? String(thrown), meta: error?.meta }
	}
}

/** The fixture's engine worker told `order`; resolves once it has taken it (its acknowledgement heard). */
async function orderFixtures(order: { type: 'slow' } | { type: 'slow-ddl' }): Promise<void> {
	const acknowledged = noticeOf({ type: 'ack', of: order.type })
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(order)
	channel.close()
	await acknowledged
}

/** Resolves once the fixture's engine worker says `expected` on the fixture channel. */
function noticeOf(expected: RuntimeFixtureNotice): Promise<void> {
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	return new Promise<void>(function waitForNotice(resolve) {
		channel.addEventListener('message', function hear(event: MessageEvent<RuntimeFixtureNotice>) {
			if (JSON.stringify(event.data) !== JSON.stringify(expected)) return
			channel.close()
			resolve()
		})
	})
}

/** How often the engine's heartbeat beats in the one-statement case. */
const BEAT_INTERVAL_MS = 200

/** How long the slowed read took, for the record. */
function logStatementTime(params: { description: string; ms: number }): void {
	console.info(`${params.description}: ${Math.round(params.ms)} ms`)
}

describe('an engine alive or lost', () => {
	it('one statement of about 1.5 s → its progress handler beats from inside it', async () => {
		const worker = new Worker(fixtureUrl({ scenario: 'progress-beat' }), { type: 'module' })
		cleanups.push(() => worker.terminate())
		const channel = new MessageChannel()
		const beats: number[] = []
		channel.port1.onmessage = function hear() {
			beats.push(performance.timeOrigin + performance.now())
		}
		const ran = new Promise<{ startedAt: number; endedAt: number }>((resolve) => {
			worker.onmessage = (event) => resolve(event.data)
		})
		worker.postMessage({ port: channel.port2, intervalMs: BEAT_INTERVAL_MS, rows: 8_000_000 }, [
			channel.port2,
		])
		const { startedAt, endedAt } = await ran
		// long enough for several intervals; beats from inside it, however late a loaded machine posts each
		const lasted = endedAt - startedAt
		expect(lasted).toBeGreaterThan(4 * BEAT_INTERVAL_MS)
		const inside = beats.filter((at) => at > startedAt && at < endedAt).length
		expect(inside).toBeGreaterThanOrEqual(2)
		channel.port1.close()
	})

	describe('one read made one long statement (each step of it slowed)', () => {
		type TestCase = { scenario: RuntimeFixtureScenario; expected: unknown }
		const testCases: Record<string, TestCase> = {
			'its progress handler beating → the read resolves': {
				scenario: 'slow-statements',
				expected: 'resolved',
			},
			'its progress handler silent → lost, no-heartbeat': {
				scenario: 'slow-statements-silent',
				expected: { key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } },
			},
		}
		for (const [description, { scenario, expected }] of Object.entries(testCases)) {
			it(description, async () => {
				const store = await openStore({
					scenario,
					heartbeatTimeoutMs: 1_500,
					progressBeatOps: 1_000,
				})
				await store.registerDocument(makeDocument())
				const records = Array.from({ length: 1_500 }, (_, index) => makeRecord({ id: `r${index}` }))
				await store.bulkWrite('doc-1', { creates: records })
				await orderFixtures({ type: 'slow' })
				const startedAt = performance.now()
				const readOutcome = await outcomeOf(store.getByDocumentId('doc-1'))
				expect(readOutcome).toEqual(expected)
				expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1_500)
				logStatementTime({ description, ms: performance.now() - startedAt })
			})
		}
	})

	it('an import holding each of its 8 batches 400 ms → it resolves: the engine beats between them', async () => {
		const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
		const startedAt = performance.now()
		const importing = store.importFile({
			file: markedFile({ markers: Array.from({ length: 8 }, () => 'pause:400') }),
			options: { chunkOptions: SMALL_BATCHES },
		})
		const importOutcome = await outcomeOf(importing)
		expect(importOutcome).toBe('resolved')
		expect(performance.now() - startedAt).toBeGreaterThanOrEqual(3_000)
	})

	it('an engine paused 3 s in a record → the import and a commit queued behind it lost, each with its id, running meanwhile, then applied', async () => {
		const store = await openStore({ heartbeatTimeoutMs: 1_000 })
		await store.registerDocument(makeDocument())
		const paused = noticeOf({ type: 'reached', marker: 'pause' })
		const importing = store.importFile({
			file: markedFile({ markers: ['pause:3000'] }),
			writeId: 'w-paused',
		})
		// sent once the engine is paused: it waits on the port behind the import
		await paused
		const committing = store.commit({
			documentId: 'doc-1',
			writeId: 'w-commit',
			creates: [makeRecord({ id: 'r1' })],
			updates: [],
			deletes: [],
			onProgress: () => {},
		})
		const importOutcome = await outcomeOf(importing)
		expect(importOutcome).toEqual({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'w-paused' },
		})
		const commitOutcome = await outcomeOf(committing)
		expect(commitOutcome).toEqual({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'w-commit' },
		})
		const pausedWriteOutcome = await store.getWriteOutcome({ writeId: 'w-paused' })
		expect(pausedWriteOutcome).toBe('running')
		const commitWriteOutcome = await store.getWriteOutcome({ writeId: 'w-commit' })
		expect(commitWriteOutcome).toBe('running')
		await expect
			.poll(() => store.getWriteOutcome({ writeId: 'w-paused' }), {
				timeout: 10_000,
				interval: 200,
			})
			.toBe('applied')
		const commitWriteOutcomeOncePausedApplied = await store.getWriteOutcome({ writeId: 'w-commit' })
		expect(commitWriteOutcomeOncePausedApplied).toBe('applied')
	})

	describe('two connections, timeout 2.5 s', () => {
		it('an import beating for about 3 s, another queued behind it → neither lost, both ready', async () => {
			const first = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
			const second = await openStore({
				heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS,
				name: first.name,
			})
			const running = first.importFile({
				file: markedFile({ markers: Array.from({ length: 8 }, () => 'pause:400') }),
				options: { chunkOptions: SMALL_BATCHES },
			})
			const queued = second.importFile({ file: markedFile({ markers: ['plain'] }) })
			const runningOutcome = await outcomeOf(running)
			const queuedOutcome = await outcomeOf(queued)
			expect([runningOutcome, queuedOutcome]).toEqual(['resolved', 'resolved'])
		})

		it('a read sent while the other’s afterImport runs 3 s of dialecte code → it resolves', async () => {
			const first = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
			const second = await openStore({
				heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS,
				name: first.name,
			})
			const pausing = noticeOf({ type: 'reached', marker: 'after-pause' })
			const importing = first.importFile({ file: markedFile({ markers: ['after-pause:3000'] }) })
			await pausing
			const readOutcome = await outcomeOf(second.getDocuments())
			expect(readOutcome).toBe('resolved')
			const importOutcome = await outcomeOf(importing)
			expect(importOutcome).toBe('resolved')
		})
	})

	it('an afterImport yielding now and then for 3 s while another connection’s large commit beats → the importer kept busy, the import resolves', async () => {
		const first = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
		const second = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS, name: first.name })
		await second.registerDocument(makeDocument())
		const yielding = noticeOf({ type: 'reached', marker: 'after-yield-pause' })
		const importing = first.importFile({
			file: markedFile({ markers: ['after-yield-pause:3000'] }),
		})
		await yielding
		const records = Array.from({ length: 20_000 }, (_, index) => makeRecord({ id: `r${index}` }))
		await second.commit({
			documentId: 'doc-1',
			creates: records,
			updates: [],
			deletes: [],
			onProgress: () => {},
		})
		const importOutcome = await outcomeOf(importing)
		expect(importOutcome).toBe('resolved')
	})

	describe('one long statement with no beat in it (an index built, a table dropped: one opcode)', () => {
		it('an import whose index builds each run 3 s (timeout 2.5 s) → told busy around each, the import resolves', async () => {
			const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
			await orderFixtures({ type: 'slow-ddl' })
			const importOutcome = await outcomeOf(
				store.importFile({ file: markedFile({ markers: ['plain'] }) }),
			)
			expect(importOutcome).toBe('resolved')
		})

		it('a second connection while the engine runs 3 s of statements told busy (timeout 2.5 s) → its adoption waits, then it reads: the engine never taken for lost', async () => {
			const name = uniqueProject()
			const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS, name })
			await store.registerDocument(makeDocument())
			await orderFixtures({ type: 'slow-ddl' })
			const slowed = noticeOf({ type: 'reached', marker: 'slow-ddl' })
			const removing = store.removeDocument('doc-1')
			await slowed
			const second = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS, name })
			const readOutcome = await outcomeOf(second.getDocuments())
			expect(readOutcome).toBe('resolved')
			const removalOutcome = await outcomeOf(removing)
			expect(removalOutcome).toBe('resolved')
		})

		it('a document removed, its tables dropped in 3 s each (timeout 2.5 s) → told busy, the removal resolves', async () => {
			const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
			await store.registerDocument(makeDocument())
			await store.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
			await orderFixtures({ type: 'slow-ddl' })
			const removalOutcome = await outcomeOf(store.removeDocument('doc-1'))
			expect(removalOutcome).toBe('resolved')
		})
	})

	it('an afterImport yielding now and then for 3 s while its own importer reads → the answer keeps it busy, the import resolves', async () => {
		const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
		const yielding = noticeOf({ type: 'reached', marker: 'after-yield-pause' })
		const importing = store.importFile({
			file: markedFile({ markers: ['after-yield-pause:3000'] }),
		})
		// read while the engine is busy in the importer's own afterImport
		await yielding
		const readOutcome = await outcomeOf(store.getDocuments())
		expect(readOutcome).toBe('resolved')
		const importOutcome = await outcomeOf(importing)
		expect(importOutcome).toBe('resolved')
	})

	it('an afterImport running 3 s of dialecte code (timeout 2.5 s) → told busy, the import resolves', async () => {
		const store = await openStore({ heartbeatTimeoutMs: KEPT_ALIVE_TIMEOUT_MS })
		const importOutcome = await outcomeOf(
			store.importFile({ file: markedFile({ markers: ['after-pause:3000'] }) }),
		)
		expect(importOutcome).toBe('resolved')
	})
})
