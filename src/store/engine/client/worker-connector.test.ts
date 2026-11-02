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
import {
	TEST_ENGINE_URL,
	fixtureUrl,
	isEngineLockFree,
	poolState,
} from '../../sqlite/runtime/runtime.fixtures'
import {
	FIXTURE_DIALECTE,
	OTHER_FIXTURE_DIALECTE,
	CROSS_REALM_CLOCK_SLACK_MS,
	CHANGE_TOLD_WITHIN_MS,
	DEAF_DESTROY_BUDGET_MS,
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	SILENT_ENGINE_WAIT_MS,
	RUNTIME_FIXTURE_CHANNEL,
	SLOW_DESTROY_MS,
} from '../../sqlite/runtime/runtime.fixtures.constants'
import { SQLITE_WASM_URL } from '../../sqlite/sqlite-wasm-url'
import { EngineStore } from '../engine-store'
import { engineLockNameOf } from '../project-key'
import { ENGINE_WIRE_PROTOCOL } from '../wire/wire.constants'
import {
	ENGINE_CLOSE_BUDGET_MS,
	ENGINE_FOLLOW_REARM_FIRST_MS,
	ENGINE_OPEN_BUDGET_MS,
} from './client.constants'
import { createEngineControl } from './engine-control'
import { destroyFromFreshWorker } from './worker-connector'

import * as Comlink from 'comlink'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { isKnownDialecteError, toDialecteError } from '@/errors'
import { createPerf } from '@/perf'
import { createSqliteWorkerConnector } from '@/store/sqlite/adapter/sqlite-worker-connector'
import { SILENCE_WAIT_MS } from '@/test/test-timing.constants'

import type { EngineLink } from '../engine-store.types'
import type { EngineApi } from '../engine.types'
import type { EngineWire } from '../wire/wire.types'
import type {
	RuntimeFixtureNotice,
	RuntimeFixtureOrder,
} from '@/store/sqlite/runtime/runtime.fixtures.types'
import type { AnyRawRecord } from '@/types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** The stores a case opened, destroyed after it: all closed first, as a project is destroyed only once no other connection has it open. */
const opened: EngineStore[] = []

afterEach(async function destroyOpenedStores() {
	const stores = opened.splice(0)
	for (const store of stores) store.close()
	for (const store of stores) await store.destroy()
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
		connector: createSqliteWorkerConnector({ ...FIXTURE_DIALECTE, name, engineUrl, perf }),
	})
	await store.open()
	opened.push(store)
	return store
}

/** What a store is told, each notice as its kind, whose change it was, its type and document. */
function shapesHeard(params: { store: EngineStore }): unknown[] {
	const heard: unknown[] = []
	params.store.subscribe(function keep(notice) {
		heard.push(
			notice.type === 'resync'
				? { type: 'resync' }
				: {
						own: notice.own,
						type: notice.message.type,
						documentId: 'documentId' in notice.message ? notice.message.documentId : undefined,
					},
		)
	})
	return heard
}

/** A change as the store named `store` is told it: its own when it made it. */
function toldTo(params: {
	change: { by: string; type: string; documentId: string }
	store: string
}): unknown {
	const { by, type, documentId } = params.change
	return { own: by === params.store, type, documentId }
}

function projectName(): string {
	return `worker-connector-${crypto.randomUUID()}`
}

/** The engine a link reaches now. */
function engineOf(params: { link: EngineLink }): Promise<EngineApi> {
	return params.link.engine()
}

/** The documents the engine a link reaches now holds. */
async function documentsOf(params: { link: EngineLink }): Promise<unknown[]> {
	const engine = await engineOf(params)
	return engine.getDocuments()
}

/** A document registered through the engine a link reaches now. */
async function registerThrough(params: { link: EngineLink }): Promise<void> {
	const engine = await engineOf(params)
	await engine.registerDocument(makeDocument())
}

/** What an action threw, or `undefined` once it resolved. */
function rejectionOf(action: Promise<unknown>): Promise<unknown> {
	return action.then(resolvedToNothing, keepThrown)
}

function resolvedToNothing(): undefined {
	return undefined
}

function keepThrown(thrown: unknown): unknown {
	return thrown
}

/** The catalog key of what an action threw. */
async function keyOfRejection(action: Promise<unknown>): Promise<string | undefined> {
	const thrown = await rejectionOf(action)
	return toDialecteError(thrown)?.key
}

/** The structured error an action threw. */
async function errorOfRejection(action: Promise<unknown>): Promise<unknown> {
	const thrown = await rejectionOf(action)
	return toDialecteError(thrown)
}

/**
 * The engine lock of `name` asked for from this page while its engine holds it: granted once that
 * engine's worker has ended, then held `holdMs` - a dead worker's lock let go late, as on a loaded
 * machine. Settles once let go.
 */
function holdLockOnceFree(params: { name: string; holdMs: number }): Promise<void> {
	const { name, holdMs } = params
	return navigator.locks.request(
		engineLockNameOf({ dialecteId: FIXTURE_DIALECTE.dialecteId, project: name }),
		function holdAWhile() {
			return new Promise<void>(function letGoLater(resolve) {
				setTimeout(resolve, holdMs)
			})
		},
	)
}

/** The fixture's engine workers told on their channel. */
function orderFixtures(order: RuntimeFixtureOrder): void {
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(order)
	channel.close()
}

/** The `destroy` requests the fixture's engine workers of `project` were sent, counted for the case. */
function countDestroysAsked(params: { project: string }): { count: () => number } {
	let asked = 0
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.onmessage = function countDestroys(event: MessageEvent<RuntimeFixtureNotice>) {
		if (event.data.type === 'destroy-asked' && event.data.project === params.project) asked += 1
	}
	onTestFinished(function closeChannel() {
		channel.close()
	})
	return {
		count: function countAsked() {
			return asked
		},
	}
}

function pause(params: { ms: number }): Promise<void> {
	return new Promise(function waitAWhile(resolve) {
		setTimeout(resolve, params.ms)
	})
}

describe('a SQLite store whose engine runs in a worker of this realm', () => {
	it('a document registered → read back through the worker', async () => {
		const store = await openWorkerStore()
		await store.registerDocument(makeDocument())
		const documents = await store.getDocuments()
		expect(documents).toEqual([makeDocument()])
	})

	it('a commit on a document not registered → the engine’s structured error: a known key, its code, detail, meta and method', async () => {
		const store = await openWorkerStore()
		const committing = commit({
			store,
			documentId: 'absent',
			creates: [makeRecord({ id: 'r1' })],
		})
		const thrown = await rejectionOf(committing)
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
		const importing = store.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${CONTRACT_SESSION_FAIL_VALUE}"/>` }),
		})
		const thrown = await rejectionOf(importing)
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
		const thrown = await rejectionOf(store.bulkWrite('doc-1', { creates: [malformed] }))
		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).name).toBe('TypeError')
		expect(toDialecteError(thrown)).toBeUndefined()
	})

	it('the engine a connection answers → no then, no symbol key: awaited, it is itself', async () => {
		const name = projectName()
		const connector = createSqliteWorkerConnector({
			...FIXTURE_DIALECTE,
			name,
			engineUrl: TEST_ENGINE_URL,
		})
		const link = await connector.connect()
		const engine = await link.engine()
		expect('then' in engine).toBe(false)
		expect((engine as unknown as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined()
		expect((engine as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
		const awaited = await Promise.resolve(engine)
		expect(awaited).toBe(engine)
		link.close()
		await connector.destroy()
	})

	it('a call naming no member of the engine, sent on a client port → ASSERTION_FAILED, nothing run', async () => {
		const worker = new Worker(TEST_ENGINE_URL, { type: 'module' })
		const control = createEngineControl({ worker })
		const project = projectName()
		await control.request({
			message: {
				type: 'open',
				project,
				...FIXTURE_DIALECTE,
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
		const read = await wire.call({ member: 'getDocuments', args: [], standIns: [] })
		expect(read).toEqual({ ok: true, value: [] })
		channel.port1.close()
		await control.request({
			message: {
				type: 'destroy',
				project,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				lock: 'if-available',
				budgetMs: 10_000,
			},
			expect: 'destroyed',
		})
		worker.terminate()
	})

	it('writes through two connections → each told every change once, its own as its own, the other’s as another’s; a refused write and a no-op tell nothing', async () => {
		const first = await openWorkerStore()
		const second = await openWorkerStore({ name: first.name })
		const firstHeard = shapesHeard({ store: first })
		const secondHeard = shapesHeard({ store: second })
		await first.registerDocument(makeDocument())
		await first.bulkWrite('doc-1', { creates: [makeRecord({ id: 'r1' })] })
		await commit({ store: second, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] })
		await expectRejectsWith({
			action: commit({ store: second, documentId: 'doc-1', creates: [makeRecord({ id: 'r2' })] }),
			key: 'STORE_DUPLICATE_ID',
		})
		await second.undo('doc-1')
		await second.redo('doc-1')
		await second.redo('doc-1')
		await first.addBlob(makeBlobEntry({ id: 'b1' }), new Blob(['b']))
		const { record } = await second.importFile({
			file: contractFile({ body: '<A aA="1"/>' }),
		})
		await first.removeDocument('doc-1')
		const changes = [
			{ by: 'first', type: 'init-empty-document', documentId: 'doc-1' },
			{ by: 'first', type: 'commit', documentId: 'doc-1' },
			{ by: 'second', type: 'commit', documentId: 'doc-1' },
			{ by: 'second', type: 'commit', documentId: 'doc-1' },
			{ by: 'second', type: 'commit', documentId: 'doc-1' },
			{ by: 'first', type: 'blob-added', documentId: 'doc-1' },
			{ by: 'second', type: 'document-imported', documentId: record.id },
			{ by: 'first', type: 'document-removed', documentId: 'doc-1' },
		]
		await vi.waitFor(
			function everyChangeTold() {
				expect(firstHeard).toEqual(
					changes.map(function toldToFirst(change) {
						return toldTo({ change, store: 'first' })
					}),
				)
				expect(secondHeard).toEqual(
					changes.map(function toldToSecond(change) {
						return toldTo({ change, store: 'second' })
					}),
				)
			},
			{ timeout: CHANGE_TOLD_WITHIN_MS },
		)
	})

	it('an import measured in the engine → its report on the worker’s clock, merged on this page within the call', async () => {
		const store = await openWorkerStore({ perf: true })
		const startedAt = performance.now()
		const { perf: report } = await store.importFile({ file: contractFile({ body: '<A aA="1"/>' }) })
		const endedAt = performance.now()
		expect(report?.timeOrigin).not.toBe(performance.timeOrigin)
		const perf = createPerf({ enabled: true, timeline: false })
		perf.merge({ report: report!, prefix: 'store' })
		const span = perf.snapshot().spans.find(function isStoreImport(merged) {
			return merged.name === 'store::import'
		})
		expect(span).toBeDefined()
		expect(span!.startTime).toBeGreaterThanOrEqual(startedAt - CROSS_REALM_CLOCK_SLACK_MS)
		expect(span!.startTime + span!.duration).toBeLessThanOrEqual(
			endedAt + CROSS_REALM_CLOCK_SLACK_MS,
		)
	})

	describe('an engine worker that does not open, ends on its own, or is deaf to close', () => {
		it('its address answers no worker, or its module fails as it loads → PROJECT_ENGINE_UNAVAILABLE before the open budget', async () => {
			for (const engineUrl of [
				new URL('./no-such-engine.worker.ts', import.meta.url).href,
				fixtureUrl({ scenario: 'broken' }),
			]) {
				const name = projectName()
				const startedAt = performance.now()
				const key = await keyOfRejection(
					createSqliteWorkerConnector({ ...FIXTURE_DIALECTE, name, engineUrl }).connect(),
				)
				expect(key, engineUrl).toBe('PROJECT_ENGINE_UNAVAILABLE')
				// told by the worker's error, not by the open budget running out
				expect(performance.now() - startedAt).toBeLessThan(ENGINE_OPEN_BUDGET_MS)
			}
		})

		it('a worker that loads and never answers its open → PROJECT_ENGINE_UNAVAILABLE once the open window has passed: the next connection starts another', async () => {
			const name = projectName()
			const startedAt = performance.now()
			// the window is never shorter than the engine's own budget and the time to answer
			const openWindowMs = SILENT_ENGINE_WAIT_MS + ENGINE_CLOSE_BUDGET_MS
			const refused = await errorOfRejection(
				createSqliteWorkerConnector({
					...FIXTURE_DIALECTE,
					name,
					engineUrl: fixtureUrl({ scenario: 'silent-open' }),
					openBudgetMs: SILENT_ENGINE_WAIT_MS,
					openWindowMs: SILENT_ENGINE_WAIT_MS,
				}).connect(),
			)
			expect(refused).toMatchObject({
				key: 'PROJECT_ENGINE_UNAVAILABLE',
				meta: { project: name, openWindowMs },
			})
			expect(performance.now() - startedAt).toBeGreaterThanOrEqual(openWindowMs)
			const store = await openWorkerStore({ name })
			const documents = await store.getDocuments()
			expect(documents).toEqual([])
		})

		it('an engine that never answers a client’s adoption, not busy → PROJECT_ENGINE_UNAVAILABLE, the engine ended: its lock free', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'silent-adopt' }),
				liveness: { heartbeatTimeoutMs: SILENT_ENGINE_WAIT_MS },
			})
			const link = await connector.connect()
			const refused = await errorOfRejection(link.engine())
			expect(refused).toMatchObject({ key: 'PROJECT_ENGINE_UNAVAILABLE', meta: { project: name } })
			// a worker ended holding the lock may let it go seconds later on a loaded machine
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 },
				)
				.toBe(true)
			link.close()
			await createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			}).destroy()
		})

		it('an engine that never answers a client’s adoption, ended by the realm → the connection’s close settles once its lock is free: a destroy right after goes ahead', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'silent-adopt' }),
				liveness: { heartbeatTimeoutMs: SILENT_ENGINE_WAIT_MS },
			})
			const link = await connector.connect()
			expect(await errorOfRejection(link.engine())).toMatchObject({
				key: 'PROJECT_ENGINE_UNAVAILABLE',
			})
			await link.close()
			// no wait: the close is settled on the ended engine's lock
			expect(await isEngineLockFree({ project: name })).toBe(true)
			await createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			}).destroy()
		})

		it('an engine address of another dialecte → PROJECT_DIALECTE_MISMATCH, nothing of the project made; one that does not check what it is asked → refused all the same, from its answer, its worker ended', async () => {
			const name = projectName()
			const otherAddress = await errorOfRejection(
				createSqliteWorkerConnector({
					...FIXTURE_DIALECTE,
					name,
					engineUrl: fixtureUrl({ scenario: 'other-dialecte' }),
				}).connect(),
			)
			expect(otherAddress).toMatchObject({
				key: 'PROJECT_DIALECTE_MISMATCH',
				meta: {
					project: name,
					projectDialecteId: OTHER_FIXTURE_DIALECTE.dialecteId,
					realmDialecteId: FIXTURE_DIALECTE.dialecteId,
				},
			})
			for (const dialecteId of [FIXTURE_DIALECTE.dialecteId, OTHER_FIXTURE_DIALECTE.dialecteId]) {
				expect(await poolState({ project: name, dialecteId }), dialecteId).toEqual({
					exists: false,
					files: 0,
				})
			}
			const unchecked = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				dialecteId: 'core/elsewhere',
				name,
				engineUrl: fixtureUrl({ scenario: 'unchecked-open' }),
			})
			// asked again at once: the next engine waits until the one refused let its own lock go
			for (const attempt of [1, 2]) {
				const refused = await errorOfRejection(unchecked.connect())
				expect(refused, `attempt ${attempt}`).toMatchObject({
					key: 'PROJECT_DIALECTE_MISMATCH',
					meta: {
						projectDialecteId: FIXTURE_DIALECTE.dialecteId,
						realmDialecteId: 'core/elsewhere',
					},
				})
			}
			// the engine that opened anyway is ended: its lock let go
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 },
				)
				.toBe(true)
			await createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			}).destroy()
		})

		it('an engine speaking another wire → STORE_PROTOCOL_MISMATCH naming both, its worker ended: the project free', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'other-wire' }),
			})
			const refused = await errorOfRejection(connector.connect())
			expect(refused).toMatchObject({
				key: 'STORE_PROTOCOL_MISMATCH',
				meta: { expected: ENGINE_WIRE_PROTOCOL, found: -1 },
			})
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS },
				)
				.toBe(true)
			const plain = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			})
			await plain.destroy()
		})

		it('ended from inside during an import → STORE_ENGINE_LOST host-gone with the import’s id; the next call starts another engine, which says not applied', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
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
			const lost = await errorOfRejection(importing)
			expect(lost).toMatchObject({
				key: 'STORE_ENGINE_LOST',
				meta: { reason: 'host-gone', writeId: 'w-gone' },
			})
			hold.release()
			const next = await link.engine()
			expect(next).not.toBe(engine)
			const outcome = await next.getWriteOutcome({ writeId: 'w-gone' })
			expect(outcome).toBe('not-applied')
			const documents = await next.getDocuments()
			expect(documents).toEqual([])
			link.close()
			await connector.destroy()
		})

		it('ended from inside, a connection only listening → it reaches the next engine on its own, told to read again; the other’s next change told to it', async () => {
			const name = projectName()
			const caller = await openWorkerStore({ name, engineUrl: fixtureUrl({ scenario: 'endable' }) })
			const listening = await openWorkerStore({
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const heard = shapesHeard({ store: listening })
			orderFixtures({ type: 'end' })
			await vi.waitFor(
				function toldToReadAgain() {
					expect(heard).toEqual([{ type: 'resync' }])
				},
				{ timeout: CHANGE_TOLD_WITHIN_MS },
			)
			await caller.registerDocument(makeDocument({ id: 'doc-after' }))
			await vi.waitFor(
				function toldTheChange() {
					expect(heard).toEqual([
						{ type: 'resync' },
						{ own: false, type: 'init-empty-document', documentId: 'doc-after' },
					])
				},
				{ timeout: CHANGE_TOLD_WITHIN_MS },
			)
		})

		type FollowCase = {
			/** How long the engine it followed runs before it ends again. */
			livedMs: number
			followedAgain: boolean
		}
		const followCases: Record<string, FollowCase> = {
			'the engine it followed lasting → it follows that end too: told to read again each time, another connection’s change after it told':
				{ livedMs: ENGINE_FOLLOW_REARM_FIRST_MS + 200, followedAgain: true },
			'the engine it followed ending at once (an engine that does not last) → not followed again: no engine runs until it calls':
				{ livedMs: 0, followedAgain: false },
		}
		for (const [description, { livedMs, followedAgain }] of Object.entries(followCases)) {
			it(`ended twice, the connection only listening, no call of its own between, ${description}`, async () => {
				const name = projectName()
				const caller = await openWorkerStore({
					name,
					engineUrl: fixtureUrl({ scenario: 'endable' }),
				})
				const listening = await openWorkerStore({
					name,
					engineUrl: fixtureUrl({ scenario: 'endable' }),
				})
				const heard = shapesHeard({ store: listening })
				orderFixtures({ type: 'end' })
				await vi.waitFor(
					function followedOnce() {
						expect(heard).toEqual([{ type: 'resync' }])
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
				await new Promise(function engineRuns(resolve) {
					setTimeout(resolve, livedMs)
				})
				orderFixtures({ type: 'end' })
				if (!followedAgain) {
					await expect
						.poll(
							function engineEnded() {
								return isEngineLockFree({ project: name })
							},
							{ timeout: CHANGE_TOLD_WITHIN_MS },
						)
						.toBe(true)
					await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS))
					expect(await isEngineLockFree({ project: name })).toBe(true)
					expect(heard).toEqual([{ type: 'resync' }])
					return
				}
				await vi.waitFor(
					function followedAgain() {
						expect(heard).toEqual([{ type: 'resync' }, { type: 'resync' }])
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
				await caller.registerDocument(makeDocument({ id: 'doc-after' }))
				await vi.waitFor(
					function toldTheChange() {
						expect(heard.at(-1)).toEqual({
							own: false,
							type: 'init-empty-document',
							documentId: 'doc-after',
						})
					},
					{ timeout: CHANGE_TOLD_WITHIN_MS },
				)
			})
		}

		it('its engine gone, the project destroyed by another tab → the connection refused PROJECT_DESTROYED_WHILE_AWAY for good; a new connection racing it opens the project anew', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const away = await connector.connect()
			const engine = await away.engine()
			await engine.registerDocument(makeDocument())
			orderFixtures({ type: 'end' })
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 },
				)
				.toBe(true)
			await destroyFromFreshWorker({
				name,
				dialecteId: FIXTURE_DIALECTE.dialecteId,
				engineUrl: TEST_ENGINE_URL,
				budgetMs: ENGINE_OPEN_BUDGET_MS,
				lock: 'wait',
			})
			// the away connection starts an engine expecting its project; a new one joins it as it opens
			const refused = keyOfRejection(away.engine())
			const fresh = await connector.connect()
			expect(await refused).toBe('PROJECT_DESTROYED_WHILE_AWAY')
			const freshEngine = await fresh.engine()
			const documents = await freshEngine.getDocuments()
			expect(documents).toEqual([])
			const again = await keyOfRejection(away.engine())
			expect(again).toBe('PROJECT_DESTROYED_WHILE_AWAY')
			await away.close()
			await fresh.close()
			await connector.destroy()
		})

		it('the last connection of the realm closed → settled once its engine let the project’s lock go: free at once after it', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			})
			const link = await connector.connect()
			await link.engine()
			await link.close()
			expect(await isEngineLockFree({ project: name })).toBe(true)
			await connector.destroy()
		})

		it('deaf to close → its worker ended once the close budget has passed: the project free again', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await link.engine()
			const startedAt = performance.now()
			link.close()
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 },
				)
				.toBe(true)
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
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			const first = await link.engine()
			orderFixtures({ type: 'end' })
			// a new worker loads SQLite and opens the pool first: seconds on a loaded machine
			await expect
				.poll(
					async function adoptedByAnother() {
						const engine = await link.engine()
						return engine !== first
					},
					{ timeout: ENGINE_WORKER_CASE_TIMEOUT_MS / 2 },
				)
				.toBe(true)
			function resumeWatches(spy: typeof added): number {
				return spy.mock.calls.filter(function isResume([type]) {
					return type === 'resume'
				}).length
			}
			expect(resumeWatches(added) - resumeWatches(removed)).toBe(1)
			link.close()
			await connector.destroy()
		})

		it('the worker it is destroyed through deaf to destroy → PROJECT_DESTROY_FAILED within the open and close budgets, the next connection not held', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-destroy' }),
				openBudgetMs: DEAF_DESTROY_BUDGET_MS,
			})
			const startedAt = performance.now()
			const refused = await errorOfRejection(connector.destroy())
			expect(refused).toMatchObject({
				key: 'PROJECT_DESTROY_FAILED',
				meta: { project: name, budgetMs: DEAF_DESTROY_BUDGET_MS },
			})
			expect(performance.now() - startedAt).toBeLessThan(
				DEAF_DESTROY_BUDGET_MS + 2 * ENGINE_CLOSE_BUDGET_MS,
			)
			const plain = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
			})
			const link = await plain.connect()
			const documents = await documentsOf({ link })
			expect(documents).toEqual([])
			link.close()
			await plain.destroy()
		})

		it('deaf to close, its lock let go 3 s after its worker ended, then destroyed → the destroy waits for the lock: the project destroyed', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			link.close()
			await connector.destroy()
			await lateRelease
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('the worker it is destroyed through slow to destroy (past the close budget, within its own) → its answer awaited: one destroy asked, the project destroyed', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'slow-destroy' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			link.close()
			const asked = countDestroysAsked({ project: name })
			expect(SLOW_DESTROY_MS).toBeGreaterThan(ENGINE_CLOSE_BUDGET_MS)
			await connector.destroy()
			await pause({ ms: 200 })
			expect(asked.count()).toBe(1)
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('a connection made while the worker it is destroyed through is still at work → it waits for the destroy, then opens: the project read empty', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'slow-destroy' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			link.close()
			const asked = countDestroysAsked({ project: name })
			const destroying = connector.destroy()
			await expect.poll(asked.count).toBe(1)
			const again = await connector.connect()
			await destroying
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('its last connection closed, destroyed at once → the destroy waits for the engine to close, then a fresh worker destroys: one destroy asked, the project destroyed', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'destroy-told' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			const asked = countDestroysAsked({ project: name })
			link.close()
			await connector.destroy()
			// the fresh worker's notice may come after its answer
			await expect.poll(asked.count).toBe(1)
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('deaf to close, its last connection closed, destroyed at once → the destroy waits the close budget for it, then destroys: the project destroyed', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			const startedAt = performance.now()
			link.close()
			await connector.destroy()
			expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENGINE_CLOSE_BUDGET_MS - 100)
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('deaf to close, its last connection closed, destroyed, a connection made while the destroy waits for it → that connection waits for the destroy: it opens on the project emptied', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			link.close()
			const destroying = connector.destroy()
			const connecting = connector.connect()
			await destroying
			const again = await connecting
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([])
			again.close()
			await connector.destroy()
		})

		it('a connector whose open budget is 500 ms, deaf to close, its lock let go 3 s after its worker ended, then destroyed → PROJECT_OPEN_ELSEWHERE: the project kept', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
				openBudgetMs: 500,
			})
			const link = await connector.connect()
			await registerThrough({ link })
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			link.close()
			const key = await keyOfRejection(connector.destroy())
			expect(key).toBe('PROJECT_OPEN_ELSEWHERE')
			await lateRelease
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([makeDocument()])
			again.close()
			await connector.destroy()
		})

		it('a destroy whose fresh worker is refused (another tab holds the project) → the next connect of the name waits the close budget for that worker, not the open budget', async () => {
			const name = projectName()
			const openBudgetMs = 6_000
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: TEST_ENGINE_URL,
				openBudgetMs,
			})
			let letGo: () => void = function noHoldYet() {}
			await new Promise<void>(function holdAsAnotherTab(held) {
				void navigator.locks.request(
					engineLockNameOf({ dialecteId: FIXTURE_DIALECTE.dialecteId, project: name }),
					function holdUntilLetGo() {
						held()
						return new Promise<void>(function untilLetGo(resolve) {
							letGo = resolve
						})
					},
				)
			})
			try {
				expect(await keyOfRejection(connector.destroy())).toBe('PROJECT_OPEN_ELSEWHERE')
				const startedAt = performance.now()
				expect(await keyOfRejection(connector.connect())).toBe('PROJECT_OPEN_ELSEWHERE')
				// refused at once, not once the open budget ran out
				expect(performance.now() - startedAt).toBeLessThan(openBudgetMs)
			} finally {
				letGo()
			}
		})

		it('ended on its own, its connection still open → the destroy refused PROJECT_OPEN_ELSEWHERE: the project kept, read through that connection', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			orderFixtures({ type: 'end' })
			await expect
				.poll(function lockFree() {
					return isEngineLockFree({ project: name })
				})
				.toBe(true)
			const refused = await errorOfRejection(connector.destroy())
			expect(refused).toMatchObject({
				key: 'PROJECT_OPEN_ELSEWHERE',
				meta: { project: name, connections: 1 },
			})
			const documents = await documentsOf({ link })
			expect(documents).toEqual([makeDocument()])
			link.close()
			await connector.destroy()
		})

		it('ended on its own, its connection closed as its next call starts → that call refused STORE_CLOSED, no other engine started: the project free at once', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			orderFixtures({ type: 'end' })
			await expect
				.poll(function lockFree() {
					return isEngineLockFree({ project: name })
				})
				.toBe(true)
			const calling = documentsOf({ link })
			link.close()
			const key = await keyOfRejection(calling)
			expect(key).toBe('STORE_CLOSED')
			const lockFree = await isEngineLockFree({ project: name })
			expect(lockFree).toBe(true)
			await connector.destroy()
		})

		it('ended on its own, two connections calling again, the first closed while the engine they started still opens → the second’s call answered: the project read', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const first = await connector.connect()
			const second = await connector.connect()
			await registerThrough({ link: first })
			orderFixtures({ type: 'end' })
			await expect
				.poll(function lockFree() {
					return isEngineLockFree({ project: name })
				})
				.toBe(true)
			const firstCalling = rejectionOf(documentsOf({ link: first }))
			const secondCalling = documentsOf({ link: second })
			// a turn later: the other engine started, its worker still loading
			await pause({ ms: 0 })
			first.close()
			await firstCalling
			const documents = await secondCalling
			expect(documents).toEqual([makeDocument()])
			second.close()
			await connector.destroy()
		})

		it('ended on its own, its connection closed while the engine its next call started still opens → that call refused STORE_CLOSED, that engine closed: the project free', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'endable' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			orderFixtures({ type: 'end' })
			await expect
				.poll(function lockFree() {
					return isEngineLockFree({ project: name })
				})
				.toBe(true)
			const calling = documentsOf({ link })
			// a turn later: the other engine started, its worker still loading
			await pause({ ms: 0 })
			link.close()
			const key = await keyOfRejection(calling)
			expect(key).toBe('STORE_CLOSED')
			await expect
				.poll(
					function lockFree() {
						return isEngineLockFree({ project: name })
					},
					{ timeout: ENGINE_CLOSE_BUDGET_MS + 3_000, interval: 100 },
				)
				.toBe(true)
			await connector.destroy()
		})

		it('a connector whose open budget is 500 ms, deaf to close, its lock let go 3 s after its worker ended → the next connection waits that budget only: PROJECT_OPEN_ELSEWHERE', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
				openBudgetMs: 500,
			})
			const link = await connector.connect()
			const lateRelease = holdLockOnceFree({ name, holdMs: 3_000 })
			link.close()
			const key = await keyOfRejection(connector.connect())
			expect(key).toBe('PROJECT_OPEN_ELSEWHERE')
			await lateRelease
			await connector.destroy()
		})

		it('deaf to close, its lock let go a moment after its worker ended, another connection at once → it waits for the lock, then opens', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
				name,
				engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
			})
			const link = await connector.connect()
			await registerThrough({ link })
			const lateRelease = holdLockOnceFree({ name, holdMs: 1_000 })
			link.close()
			const again = await connector.connect()
			const documents = await documentsOf({ link: again })
			expect(documents).toEqual([makeDocument()])
			await lateRelease
			again.close()
			await connector.destroy()
		})

		it('a store closed, another of the name opened at once → it opens and reads', async () => {
			const first = await openWorkerStore()
			await first.registerDocument(makeDocument())
			await first.close()
			const second = await openWorkerStore({ name: first.name })
			const documents = await second.getDocuments()
			expect(documents).toEqual([makeDocument()])
		})

		it('an uncaught error thrown from a timer in the engine during an import → the import resolves, nothing lost', async () => {
			const name = projectName()
			const connector = createSqliteWorkerConnector({
				...FIXTURE_DIALECTE,
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
			await pause({ ms: 200 })
			hold.release()
			const { record } = await importing
			expect(record.status).toBe('ready')
			link.close()
			await connector.destroy()
		})
	})
})
