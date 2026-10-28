import {
	SMALL_BATCHES,
	contractFile,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { createEngineClient } from '../../engine/client/engine-client'
import { EngineStore } from '../../engine/engine-store'
import { fixtureUrl, removePoolDirectory, uniqueProject } from './runtime.fixtures'
import { RUNTIME_FIXTURE_CHANNEL } from './runtime.fixtures.constants'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'

import type { RuntimeFixtureScenario } from './runtime.fixtures.types'

/** What a case leaves: its stores destroyed, its pools removed. */
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
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
		name,
		engineUrl: fixtureUrl({ scenario }),
		liveness: { heartbeatTimeoutMs, heartbeatIntervalMs: 100 },
		progressBeatOps,
	})
	const store = new EngineStore({ name, connector })
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

function orderFixtures(order: { type: 'slow' }): void {
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(order)
	channel.close()
}

/** How long the slowed read took, for the record. */
function logStatementTime(params: { description: string; ms: number }): void {
	console.info(`${params.description}: ${Math.round(params.ms)} ms`)
}

function busyWait(params: { ms: number }): void {
	const until = performance.now() + params.ms
	while (performance.now() < until);
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
		worker.postMessage({ port: channel.port2, intervalMs: 200, rows: 8_000_000 }, [channel.port2])
		const { startedAt, endedAt } = await ran
		expect(endedAt - startedAt).toBeGreaterThan(1_000)
		expect(beats.filter((at) => at > startedAt && at < endedAt).length).toBeGreaterThanOrEqual(3)
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
				orderFixtures({ type: 'slow' })
				// the order crosses the channel before the read is sent
				await new Promise((resolve) => setTimeout(resolve, 100))
				const startedAt = performance.now()
				expect(await outcomeOf(store.getByDocumentId('doc-1'))).toEqual(expected)
				expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1_500)
				logStatementTime({ description, ms: performance.now() - startedAt })
			})
		}
	})

	it('an import holding each of its 8 batches 400 ms → it resolves: the engine beats between them', async () => {
		const store = await openStore({ heartbeatTimeoutMs: 1_500 })
		const startedAt = performance.now()
		const importing = store.importFile({
			file: markedFile({ markers: Array.from({ length: 8 }, () => 'pause:400') }),
			options: { chunkOptions: SMALL_BATCHES },
		})
		expect(await outcomeOf(importing)).toBe('resolved')
		expect(performance.now() - startedAt).toBeGreaterThanOrEqual(3_000)
	})

	it('an engine paused 3 s in a record → the import and a commit queued behind it lost, each with its id, running meanwhile, then applied', async () => {
		const store = await openStore({ heartbeatTimeoutMs: 1_000 })
		await store.registerDocument(makeDocument())
		const importing = store.importFile({
			file: markedFile({ markers: ['pause:3000'] }),
			writeId: 'w-paused',
		})
		// sent once the engine is paused: it waits on the port behind the import
		await new Promise((resolve) => setTimeout(resolve, 300))
		const committing = store.commit({
			documentId: 'doc-1',
			writeId: 'w-commit',
			creates: [makeRecord({ id: 'r1' })],
			updates: [],
			deletes: [],
			onProgress: () => {},
		})
		expect(await outcomeOf(importing)).toEqual({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'w-paused' },
		})
		expect(await outcomeOf(committing)).toEqual({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'no-heartbeat', writeId: 'w-commit' },
		})
		expect(await store.getWriteOutcome({ writeId: 'w-paused' })).toBe('running')
		expect(await store.getWriteOutcome({ writeId: 'w-commit' })).toBe('running')
		await expect
			.poll(() => store.getWriteOutcome({ writeId: 'w-paused' }), {
				timeout: 10_000,
				interval: 200,
			})
			.toBe('applied')
		expect(await store.getWriteOutcome({ writeId: 'w-commit' })).toBe('applied')
	})

	describe('two connections, timeout 1.5 s', () => {
		it('an import beating for about 3 s, another queued behind it → neither lost, both ready', async () => {
			const first = await openStore({ heartbeatTimeoutMs: 1_500 })
			const second = await openStore({ heartbeatTimeoutMs: 1_500, name: first.name })
			const running = first.importFile({
				file: markedFile({ markers: Array.from({ length: 8 }, () => 'pause:400') }),
				options: { chunkOptions: SMALL_BATCHES },
			})
			const queued = second.importFile({ file: markedFile({ markers: ['plain'] }) })
			expect([await outcomeOf(running), await outcomeOf(queued)]).toEqual(['resolved', 'resolved'])
		})

		it('a read sent while the other’s afterImport runs 3 s of dialecte code → it resolves', async () => {
			const first = await openStore({ heartbeatTimeoutMs: 1_500 })
			const second = await openStore({ heartbeatTimeoutMs: 1_500, name: first.name })
			const importing = first.importFile({ file: markedFile({ markers: ['after-pause:3000'] }) })
			await new Promise((resolve) => setTimeout(resolve, 300))
			expect(await outcomeOf(second.getDocuments())).toBe('resolved')
			expect(await outcomeOf(importing)).toBe('resolved')
		})
	})

	it('an afterImport yielding now and then for 3 s while another connection’s large commit beats → the importer kept busy, the import resolves', async () => {
		const first = await openStore({ heartbeatTimeoutMs: 1_000 })
		const second = await openStore({ heartbeatTimeoutMs: 1_000, name: first.name })
		await second.registerDocument(makeDocument())
		const importing = first.importFile({
			file: markedFile({ markers: ['after-yield-pause:3000'] }),
		})
		await new Promise((resolve) => setTimeout(resolve, 300))
		const records = Array.from({ length: 20_000 }, (_, index) => makeRecord({ id: `r${index}` }))
		await second.commit({
			documentId: 'doc-1',
			creates: records,
			updates: [],
			deletes: [],
			onProgress: () => {},
		})
		expect(await outcomeOf(importing)).toBe('resolved')
	})

	it('an afterImport running 3 s of dialecte code (timeout 1 s) → told busy, the import resolves', async () => {
		const store = await openStore({ heartbeatTimeoutMs: 1_000 })
		expect(
			await outcomeOf(store.importFile({ file: markedFile({ markers: ['after-pause:3000'] }) })),
		).toBe('resolved')
	})
})

describe('a client watching its engine', () => {
	it('the document resumed (a frozen tab coming back) while a call waits → the silence counts from the resume', async () => {
		const channel = new MessageChannel()
		const client = createEngineClient({ port: channel.port1, heartbeatTimeoutMs: 300 })
		cleanups.push(() => client.close({ storeName: 'watched' }))
		const calling = outcomeOf(client.api.getDocuments())
		await new Promise((resolve) => setTimeout(resolve, 250))
		document.dispatchEvent(new Event('resume'))
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 200)),
		])
		expect(early).toBe('waiting')
		expect(await calling).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
		channel.port2.close()
	})

	it('its page stalled past the timeout while a beat waited → no loss: the beat is read first; silent after → lost', async () => {
		const channel = new MessageChannel()
		const client = createEngineClient({ port: channel.port1, heartbeatTimeoutMs: 300 })
		cleanups.push(() => client.close({ storeName: 'watched' }))
		const calling = outcomeOf(client.api.getDocuments())
		channel.port2.postMessage({ type: 'heartbeat' })
		busyWait({ ms: 500 })
		const early = await Promise.race([
			calling,
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 150)),
		])
		expect(early).toBe('waiting')
		expect(await calling).toEqual({ key: 'STORE_ENGINE_LOST', meta: { reason: 'no-heartbeat' } })
		channel.port2.close()
	})
})
