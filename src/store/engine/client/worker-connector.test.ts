import {
	CONTRACT_ENGINE_URL,
	CONTRACT_SESSION_FAIL_VALUE,
} from '../../contract/store-contract.constants'
import {
	commit,
	contractFile,
	expectRejectsWith,
	makeBlobEntry,
	makeDocument,
	makeRecord,
} from '../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../contract/store-contract.import-session'
import { TEST_ENGINE_URL, fixtureUrl } from '../../sqlite/runtime/runtime.fixtures'
import {
	CROSS_REALM_CLOCK_SLACK_MS,
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	RUNTIME_FIXTURE_CHANNEL,
	SLOW_DESTROY_MS,
} from '../../sqlite/runtime/runtime.fixtures.constants'
import { SQLITE_WASM_URL } from '../../sqlite/sqlite-wasm-url'
import { EngineStore } from '../engine-store'
import { ENGINE_LOCK_PREFIX } from '../engine.constants'
import { ENGINE_CLOSE_BUDGET_MS, ENGINE_OPEN_BUDGET_MS } from './client.constants'
import { createEngineControl } from './engine-control'

import * as Comlink from 'comlink'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { isKnownDialecteError, toDialecteError } from '@/errors'
import { createPerf } from '@/perf'
import { projectChannelName } from '@/project/project-channel'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'

import type { EngineWire } from '../wire/wire.types'
import type { ProjectChannelMessage } from '@/project/types'
import type { AnyRawRecord } from '@/types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** The stores a case opened, destroyed after it. */
const opened: EngineStore[] = []

afterEach(async () => {
	for (const store of opened.splice(0)) await store.destroy()
})

async function openWorkerStore(
	params: { name?: string; perf?: boolean; engineUrl?: string } = {},
): Promise<EngineStore> {
	const {
		name = `worker-connector-${crypto.randomUUID()}`,
		perf,
		engineUrl = TEST_ENGINE_URL,
	} = params
	const store = new EngineStore({
		name,
		connector: createSqliteWorkerConnector({ name, engineUrl, perf }),
	})
	await store.open()
	opened.push(store)
	return store
}

/** The open budget of a deaf-destroy case needing no long lock wait: its engine counts as deaf after it and the close budget. */
const DEAF_DESTROY_BUDGET_MS = 1_500

/**
 * The engine lock of `name` asked for from this page while its engine holds it: granted once that
 * engine's worker has ended, then held `holdMs` - a dead worker's lock let go late, as on a loaded
 * machine. Settles once let go.
 */
function holdLockOnceFree(params: { name: string; holdMs: number }): Promise<void> {
	const { name, holdMs } = params
	return navigator.locks.request(`${ENGINE_LOCK_PREFIX}${name}`, function holdAWhile() {
		return new Promise<void>(function letGoLater(resolve) {
			setTimeout(resolve, holdMs)
		})
	})
}

describe('a SQLite store whose engine runs in a worker of this realm', () => {
	it('a document registered → read back through the worker', async () => {
		const store = await openWorkerStore()
		await store.registerDocument(makeDocument())
		expect(await store.getDocuments()).toEqual([makeDocument()])
	})

	it('a commit on a document not registered → the engine’s structured error: a known key, its code, detail, meta and method', async () => {
		const store = await openWorkerStore()
		const thrown = await commit({
			store,
			documentId: 'absent',
			creates: [makeRecord({ id: 'r1' })],
		}).catch((error: unknown) => error)
		const error = toDialecteError(thrown)
		expect(error).toMatchObject({
			key: 'DOCUMENT_NOT_REGISTERED',
			code: 'D7002',
			detail: expect.stringContaining('"absent"'),
			meta: { documentId: 'absent' },
			method: expect.any(String),
		})
		expect(error && isKnownDialecteError(error, { catalogues: [] })).toBe(true)
	})

	it('an import whose session throws a plain Error → IMPORT_FAILED, that Error its cause with its message', async () => {
		const store = await openWorkerStore({ engineUrl: CONTRACT_ENGINE_URL })
		const thrown = await store
			.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>` }),
			})
			.catch((error: unknown) => error)
		const error = toDialecteError(thrown)
		expect(error?.key).toBe('IMPORT_FAILED')
		expect(error?.cause).toBeInstanceOf(Error)
		expect(error?.cause?.message).toMatch(/the contract session fails on record/)
	})

	it('a record with no namespace → a plain TypeError, no structured error', async () => {
		const store = await openWorkerStore()
		await store.registerDocument(makeDocument())
		const malformed = {
			...makeRecord({ id: 'r1' }),
			namespace: undefined,
		} as unknown as AnyRawRecord
		const thrown = await store
			.bulkWrite('doc-1', { creates: [malformed] })
			.catch((error: unknown) => error)
		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).name).toBe('TypeError')
		expect(toDialecteError(thrown)).toBeUndefined()
	})

	it('the engine a connection answers → no then, no symbol key: awaited, it is itself', async () => {
		const name = `worker-connector-${crypto.randomUUID()}`
		const connector = createSqliteWorkerConnector({ name, engineUrl: TEST_ENGINE_URL })
		const link = await connector.connect()
		const engine = await link.engine()
		expect('then' in engine).toBe(false)
		expect((engine as unknown as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined()
		expect((engine as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
		expect(await Promise.resolve(engine)).toBe(engine)
		link.close()
		await connector.destroy()
	})

	it('a call naming no member of the engine, sent on a client port → ASSERTION_FAILED, nothing run', async () => {
		const worker = new Worker(TEST_ENGINE_URL, { type: 'module' })
		const control = createEngineControl({ worker })
		const project = `worker-connector-${crypto.randomUUID()}`
		await control.request({
			message: {
				type: 'open',
				project,
				settings: { wasmUrl: SQLITE_WASM_URL },
				lock: 'if-available',
				budgetMs: 10_000,
				perf: false,
			},
			expect: 'opened',
		})
		const channel = new MessageChannel()
		await control.request({
			message: { type: 'adopt-client', clientId: 'raw', port: channel.port2 },
			expect: 'adopted',
			transfer: [channel.port2],
		})
		const wire = Comlink.wrap<EngineWire>(channel.port1)
		for (const member of ['constructor', 'toString', '__proto__', 'close']) {
			const answer = await wire.call({ member, args: [], standIns: [] })
			expect(answer.ok, member).toBe(false)
			if (!answer.ok)
				expect(answer.thrown).toMatchObject({
					kind: 'dialecte',
					error: { key: 'ASSERTION_FAILED' },
				})
		}
		expect(await wire.call({ member: 'getDocuments', args: [], standIns: [] })).toEqual({
			ok: true,
			value: [],
		})
		channel.port1.close()
		await control.request({
			message: { type: 'destroy', project, lock: 'if-available', budgetMs: 10_000 },
			expect: 'destroyed',
		})
		worker.terminate()
	})

	it('writes through two connections → the project’s channel tells each, with the id of the connection that made it; a refused write tells nothing', async () => {
		const first = await openWorkerStore()
		const second = await openWorkerStore({ name: first.name })
		const listener = new BroadcastChannel(projectChannelName({ name: first.name }))
		const heard: (ProjectChannelMessage & { clientId: string })[] = []
		listener.onmessage = function hear(event) {
			heard.push(event.data)
		}
		await first.registerDocument(makeDocument())
		await first.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
		await commit({ store: second, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
		await expectRejectsWith({
			action: commit({ store: second, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] }),
			key: 'STORE_DUPLICATE_ID',
		})
		await second.undo('doc-1')
		await first.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['b']))
		const { record } = await second.importFile({
			file: contractFile({ body: '<A aA="1"/>' }),
		})
		await first.removeDocument('doc-1')
		await expect.poll(() => heard.length, { timeout: 5_000 }).toBe(7)
		listener.close()
		const told = heard.map(({ type, clientId, ...rest }) => ({
			type,
			documentId: 'documentId' in rest ? rest.documentId : undefined,
			clientId,
		}))
		const [firstId, secondId] = [told[0]!.clientId, told[2]!.clientId]
		expect(firstId).not.toBe(secondId)
		expect(told).toEqual([
			{ type: 'init-empty-document', documentId: 'doc-1', clientId: firstId },
			{ type: 'commit', documentId: 'doc-1', clientId: firstId },
			{ type: 'commit', documentId: 'doc-1', clientId: secondId },
			{ type: 'commit', documentId: 'doc-1', clientId: secondId },
			{ type: 'blob-added', documentId: 'doc-1', clientId: firstId },
			{ type: 'document-imported', documentId: record.id, clientId: secondId },
			{ type: 'document-removed', documentId: 'doc-1', clientId: firstId },
		])
		expect(heard.every((message) => typeof message.timestamp === 'number')).toBe(true)
	})

	it('an import measured in the engine → its report on the worker’s clock, merged on this page within the call', async () => {
		const store = await openWorkerStore({ perf: true })
		const startedAt = performance.now()
		const { perf: report } = await store.importFile({ file: contractFile({ body: '<A aA="1"/>' }) })
		const endedAt = performance.now()
		expect(report?.timeOrigin).not.toBe(performance.timeOrigin)
		const perf = createPerf({ enabled: true, timeline: false })
		perf.merge({ report: report!, prefix: 'store' })
		const span = perf.snapshot().spans.find((merged) => merged.name === 'store::import')
		expect(span).toBeDefined()
		expect(span!.startTime).toBeGreaterThanOrEqual(startedAt - CROSS_REALM_CLOCK_SLACK_MS)
		expect(span!.startTime + span!.duration).toBeLessThanOrEqual(
			endedAt + CROSS_REALM_CLOCK_SLACK_MS,
		)
	})

	describe('an engine worker that does not open, ends on its own, or is deaf to close', () => {
		/** The fixture's engine workers told on their channel. */
		function orderFixtures(order: { type: 'end' } | { type: 'throw-later' }): void {
			const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
			channel.postMessage(order)
			channel.close()
		}

		async function rejectionOf(action: Promise<unknown>): Promise<unknown> {
			return action.then(
				() => undefined,
				(error: unknown) => error,
			)
		}

		it('its address answers no worker, or its module fails as it loads → PROJECT_ENGINE_UNAVAILABLE before the open budget', async () => {
			for (const engineUrl of [
				new URL('./no-such-engine.worker.ts', import.meta.url).href,
				fixtureUrl({ scenario: 'broken' }),
			]) {
				const name = `worker-connector-${crypto.randomUUID()}`
				const startedAt = performance.now()
				const thrown = await rejectionOf(createSqliteWorkerConnector({ name, engineUrl }).connect())
				expect(toDialecteError(thrown)?.key, engineUrl).toBe('PROJECT_ENGINE_UNAVAILABLE')
				// told by the worker's error, not by the open budget running out
				expect(performance.now() - startedAt).toBeLessThan(ENGINE_OPEN_BUDGET_MS)
			}
		})

		it('ended from inside during an import → STORE_ENGINE_LOST host-gone with the import’s id; the next call starts another engine, which says not applied', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			const engine = await link.engine()
			const hold = holdContractImport()
			const importing = engine.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-gone',
			})
			await untilHeld({ hold, importing })
			orderFixtures({ type: 'end' })
			expect(toDialecteError(await rejectionOf(importing))).toMatchObject({
				key: 'STORE_ENGINE_LOST',
				meta: { reason: 'host-gone', writeId: 'w-gone' },
			})
			hold.release()
			const next = await link.engine()
			expect(next).not.toBe(engine)
			expect(await next.getWriteOutcome({ writeId: 'w-gone' })).toBe('not-applied')
			expect(await next.getDocuments()).toEqual([])
			link.close()
			await connector.destroy()
		})

		it('deaf to close → its worker ended once the close budget has passed: the project free again', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await link.engine()
			const startedAt = performance.now()
			link.close()
			const free = () =>
				navigator.locks.request(
					`dialecte:engine:${name}`,
					{ ifAvailable: true },
					(lock) => lock !== null,
				)
			await expect.poll(free, { timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 }).toBe(true)
			expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENGINE_CLOSE_BUDGET_MS - 100)
			await connector.destroy()
		})

		it('ended from inside, the next call adopted by another engine → the first client let go: one page watch left', async () => {
			const added = vi.spyOn(document, 'addEventListener')
			const removed = vi.spyOn(document, 'removeEventListener')
			onTestFinished(function restoreSpies() {
				added.mockRestore()
				removed.mockRestore()
			})
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			const first = await link.engine()
			orderFixtures({ type: 'end' })
			// a new worker loads SQLite and opens the pool first: seconds on a loaded machine
			await expect
				.poll(() => link.engine().then((api) => api !== first), {
					timeout: ENGINE_WORKER_CASE_TIMEOUT_MS / 2,
				})
				.toBe(true)
			const watches = (spy: typeof added) =>
				spy.mock.calls.filter(([type]) => type === 'resume').length
			expect(watches(added) - watches(removed)).toBe(1)
			link.close()
			await connector.destroy()
		})

		it('deaf to destroy while it serves the project → ended once its open and close budgets have passed, the project destroyed from a fresh worker', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy' }),
				openBudgetMs: DEAF_DESTROY_BUDGET_MS,
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			await connector.destroy()
			const again = await connector.connect()
			expect(await (await again.engine()).getDocuments()).toEqual([])
			again.close()
			link.close()
			await connector.destroy()
		})

		it('deaf to destroy, its lock let go 3 s after its worker ended → the realm waits for the lock within its open budget, then a fresh worker destroys: the project destroyed', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy' }),
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			await connector.destroy()
			await lateRelease
			link.close()
			const again = await connector.connect()
			expect(await (await again.engine()).getDocuments()).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('deaf to close, its lock let go 3 s after its worker ended, then destroyed → the destroy waits for the lock: the project destroyed', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			link.close()
			await connector.destroy()
			await lateRelease
			const again = await connector.connect()
			expect(await (await again.engine()).getDocuments()).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('deaf to destroy, its lock still held past the open budget after its worker ended → PROJECT_ENGINE_BUSY, no fresh worker tried', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy' }),
				openBudgetMs: DEAF_DESTROY_BUDGET_MS,
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			const lateRelease = holdLockOnceFree({ name, holdMs: 2 * DEAF_DESTROY_BUDGET_MS })
			expect(toDialecteError(await rejectionOf(connector.destroy()))).toMatchObject({
				key: 'PROJECT_ENGINE_BUSY',
				meta: { project: name, budgetMs: DEAF_DESTROY_BUDGET_MS },
			})
			await lateRelease
			link.close()
			await connector.destroy()
		})

		it('deaf to destroy, a call in flight on it → that call refused STORE_ENGINE_LOST host-gone once its worker is ended', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy' }),
				openBudgetMs: DEAF_DESTROY_BUDGET_MS,
			})
			const link = await connector.connect()
			const engine = await link.engine()
			const hold = holdContractImport()
			const importing = engine.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-deaf',
			})
			await untilHeld({ hold, importing })
			const destroying = connector.destroy()
			expect(toDialecteError(await rejectionOf(importing))).toMatchObject({
				key: 'STORE_ENGINE_LOST',
				meta: { reason: 'host-gone', writeId: 'w-deaf' },
			})
			hold.release()
			await destroying
			link.close()
		})

		it('deaf to destroy, a call in flight refused host-gone, the connection called again at once → that call waits for the destroy (a fresh worker slow to take it): the project destroyed, read empty', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy-slow-fresh' }),
				openBudgetMs: DEAF_DESTROY_BUDGET_MS,
			})
			const link = await connector.connect()
			const engine = await link.engine()
			await engine.registerDocument(makeDocument())
			const hold = holdContractImport()
			const importing = engine.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-deaf',
			})
			await untilHeld({ hold, importing })
			const destroying = connector.destroy()
			await rejectionOf(importing)
			hold.release()
			// the caller's retry, before the realm has destroyed the project through a fresh worker
			const again = (await link.engine()).getDocuments()
			await destroying
			expect(await again).toEqual([])
			link.close()
			await connector.destroy()
		})

		it('a running engine slow to destroy (past the close budget, within its own) → its answer awaited: one destroy asked, no fresh worker', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'slow-destroy' }),
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			const asked: string[] = []
			const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
			channel.onmessage = function countDestroys(event: MessageEvent<{ type?: string }>) {
				if (event.data?.type === 'destroy-asked') asked.push('destroy')
			}
			onTestFinished(function closeChannel() {
				channel.close()
			})
			expect(SLOW_DESTROY_MS).toBeGreaterThan(ENGINE_CLOSE_BUDGET_MS)
			await connector.destroy()
			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(asked).toEqual(['destroy'])
			link.close()
			const again = await connector.connect()
			expect(await (await again.engine()).getDocuments()).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('a connector whose open budget is 500 ms, deaf to close, its lock let go 3 s after its worker ended → the next connection waits that budget only: PROJECT_OPEN_ELSEWHERE', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
				openBudgetMs: 500,
			})
			const link = await connector.connect()
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			link.close()
			expect(toDialecteError(await rejectionOf(connector.connect()))?.key).toBe(
				'PROJECT_OPEN_ELSEWHERE',
			)
			await lateRelease
			await connector.destroy()
		})

		it('deaf to close, its lock let go a moment after its worker ended, another connection at once → it waits for the lock, then opens', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await (await link.engine()).registerDocument(makeDocument())
			const lateRelease = holdLockOnceFree({ name, holdMs: 1_000 })
			link.close()
			const again = await connector.connect()
			expect(await (await again.engine()).getDocuments()).toEqual([makeDocument()])
			await lateRelease
			again.close()
			await connector.destroy()
		})

		it('a store closed, another of the name opened at once → it opens and reads', async () => {
			const first = await openWorkerStore()
			await first.registerDocument(makeDocument())
			await first.close()
			const second = await openWorkerStore({ name: first.name })
			expect(await second.getDocuments()).toEqual([makeDocument()])
		})

		it('an uncaught error thrown from a timer in the engine during an import → the import resolves, nothing lost', async () => {
			const name = `worker-connector-${crypto.randomUUID()}`
			const connector = createSqliteWorkerConnector({
				name,
				engineUrl: fixtureUrl({ scenario: 'uncaught-error' }),
			})
			const link = await connector.connect()
			const engine = await link.engine()
			const hold = holdContractImport()
			const importing = engine.importFile({
				file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
				writeId: 'w-kept',
			})
			await untilHeld({ hold, importing })
			orderFixtures({ type: 'throw-later' })
			await new Promise((resolve) => setTimeout(resolve, 200))
			hold.release()
			expect((await importing).record.status).toBe('ready')
			link.close()
			await connector.destroy()
		})
	})
})
