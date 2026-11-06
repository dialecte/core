import { fixtureUrl, isEngineLockFree, TEST_ENGINE_URL } from '../../runtime/runtime.fixtures'
import {
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	RUNTIME_FIXTURE_CHANNEL,
	SILENT_ENGINE_WAIT_MS,
} from '../../runtime/runtime.fixtures.constants'
import { ENGINE_CLOSE_BUDGET_MS } from '../client/client.constants'
import { createEngineClient } from '../client/engine-client'
import { engineLockNameOf } from '../engine-lock'
import { fromThrownData } from '../wire/error-envelope'
import { loadSettings, recordingEngineUrl } from './hub.fixtures'
import { createRealmHost } from './realm-host'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDialecteError, toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { RealmToHubMessage } from './hub-protocol.types'
import type { RealmEngineSpawner, RealmHost } from './realm-host.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

const OPEN_BUDGET_MS = 10_000

/** What a case leaves: every engine it hosted ended. */
const hosts: RealmHost[] = []

afterEach(function endEngines() {
	for (const host of hosts.splice(0)) host.endAll()
})

/** What the host told the hub, and a wait for the next report of a type. */
type Reports = {
	host: RealmHost
	next: <GenericType extends RealmToHubMessage['type']>(
		type: GenericType,
	) => Promise<Extract<RealmToHubMessage, { type: GenericType }>>
}

function spawnerOf(params: { engineUrl?: string } = {}): RealmEngineSpawner {
	return {
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: TEST_DIALECTE.version,
		engineUrl: params.engineUrl ?? TEST_ENGINE_URL,
		settings: loadSettings,
	}
}

/** A realm host whose reports to the hub are kept and waited for. */
function hostWith(params: { spawners: RealmEngineSpawner[]; adoptBudgetMs?: number }): Reports {
	const received: RealmToHubMessage[] = []
	const waiters: { type: string; resolve: (message: RealmToHubMessage) => void }[] = []
	const host = createRealmHost({
		spawners: params.spawners,
		adoptBudgetMs: params.adoptBudgetMs,
		report: function keepReport(message) {
			const waiter = waiters.find(function waitsFor(candidate) {
				return candidate.type === message.type
			})
			if (!waiter) {
				received.push(message)
				return
			}
			waiters.splice(waiters.indexOf(waiter), 1)
			waiter.resolve(message)
		},
	})
	hosts.push(host)
	return {
		host,
		next: function nextOf(type) {
			const index = received.findIndex(function isOfType(message) {
				return message.type === type
			})
			if (index >= 0) {
				const [message] = received.splice(index, 1)
				return Promise.resolve(message) as never
			}
			return new Promise(function waitForType(resolve) {
				waiters.push({ type, resolve: resolve as (message: RealmToHubMessage) => void })
			})
		},
	}
}

/** What the recording worker was asked to open with, read from the host's report. */
async function openedWith(params: { reports: Reports }): Promise<unknown> {
	const failed = await params.reports.next('engine-open-failed')
	return fromThrownData({ data: failed.error })
}

function settingsOf(params: { marker: string }): () => Promise<unknown> {
	return function loadMarked() {
		return Promise.resolve({ marker: params.marker })
	}
}

function uniqueProject(): string {
	return `realm-host-${crypto.randomUUID()}`
}

function spawnFor(params: { reports: Reports; project: string; dialecteId?: string }): void {
	params.reports.host.spawn({
		project: params.project,
		dialecteId: params.dialecteId ?? TEST_DIALECTE.id,
		generation: 1,
		openBudgetMs: OPEN_BUDGET_MS,
	})
}

/** The project's engine lock let go within `withinMs`. */
async function lockFreeWithin(params: { project: string; withinMs: number }): Promise<void> {
	await expect
		.poll(
			function lockFree() {
				return isEngineLockFree({ project: params.project })
			},
			{ timeout: params.withinMs, interval: 50 },
		)
		.toBe(true)
}

/** A client of the hosted engine adopted on a port of its own: its end of the port. */
async function adoptClient(params: {
	reports: Reports
	project: string
	clientId: string
}): Promise<MessagePort> {
	const channel = new MessageChannel()
	params.reports.host.adopt({
		project: params.project,
		generation: 1,
		adoptionId: 1,
		clientId: params.clientId,
		port: channel.port2,
	})
	await params.reports.next('client-adopted')
	return channel.port1
}

function keyOf(params: { error: unknown }): string | undefined {
	return toDialecteError(fromThrownData({ data: params.error as never }))?.key
}

function pause(params: { ms: number }): Promise<void> {
	return new Promise(function waitAWhile(resolve) {
		setTimeout(resolve, params.ms)
	})
}

describe('a realm hosting engines for the hub', () => {
	it('asked to spawn → the engine opened, `engine-opened` told; a client adopted → `client-adopted`, its port answers the engine', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		const project = uniqueProject()
		spawnFor({ reports, project })
		const opened = await reports.next('engine-opened')
		expect(opened).toEqual({
			type: 'engine-opened',
			project,
			dialecteId: TEST_DIALECTE.id,
			generation: 1,
			creationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		})
		const port = await adoptClient({ reports, project, clientId: 'tab' })
		const client = createEngineClient({ port })
		const documents = await client.api.getDocuments()
		expect(documents).toEqual([])
		client.close({ storeName: project })
	})

	it('a spawner added after the host was made → its dialecte spawned, opened with its own settings', async () => {
		const reports = hostWith({ spawners: [] })
		reports.host.add({
			spawners: [
				{
					...spawnerOf({ engineUrl: recordingEngineUrl() }),
					settings: settingsOf({ marker: 'added' }),
				},
			],
		})
		spawnFor({ reports, project: uniqueProject() })
		const opened = await openedWith({ reports })
		expect(opened).toEqual({
			dialecteId: TEST_DIALECTE.id,
			perf: false,
			settings: { marker: 'added' },
		})
	})

	it('a spawner added for a dialecte it hosts already, measured → the next engine measured; the first one’s settings kept', async () => {
		const engineUrl = recordingEngineUrl()
		const first: RealmEngineSpawner = {
			...spawnerOf({ engineUrl }),
			settings: settingsOf({ marker: 'first' }),
		}
		const reports = hostWith({ spawners: [first] })
		reports.host.add({
			spawners: [
				{ ...spawnerOf({ engineUrl }), settings: settingsOf({ marker: 'second' }), perf: true },
			],
		})
		spawnFor({ reports, project: uniqueProject() })
		const opened = await openedWith({ reports })
		expect(opened).toEqual({
			dialecteId: TEST_DIALECTE.id,
			perf: true,
			settings: { marker: 'first' },
		})
		// the host measures its own copy: the spawner the page gave is left as it was
		expect(first.perf).toBeUndefined()
	})

	it('a spawner whose settings fail to load → `engine-open-failed` STORE_CONNECTION_FAILED at once, nothing opened: the project’s lock free', async () => {
		const project = uniqueProject()
		const reports = hostWith({
			spawners: [
				{
					...spawnerOf(),
					settings: function failToLoad() {
						return Promise.reject(
							createDialecteError('STORE_CONNECTION_FAILED', { detail: 'offline' }),
						)
					},
				},
			],
		})
		const askedAt = performance.now()
		spawnFor({ reports, project })
		const failed = await reports.next('engine-open-failed')
		expect(failed.key).toBe('STORE_CONNECTION_FAILED')
		expect(performance.now() - askedAt).toBeLessThan(OPEN_BUDGET_MS)
		await lockFreeWithin({ project, withinMs: 2_000 })
	})

	it('asked for a dialecte it has no spawner for → `engine-open-failed` with no key, the error PROJECT_ENGINE_UNAVAILABLE', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		spawnFor({ reports, project: uniqueProject(), dialecteId: 'elsewhere' })
		const failed = await reports.next('engine-open-failed')
		expect(failed.key).toBeUndefined()
		expect(keyOf({ error: failed.error })).toBe('PROJECT_ENGINE_UNAVAILABLE')
	})

	it('a spawner whose address serves another dialecte, or an engine that does not check what it is asked → `engine-open-failed` PROJECT_DIALECTE_MISMATCH, the lock free', async () => {
		for (const engineUrl of [
			fixtureUrl({ scenario: 'other-dialecte' }),
			fixtureUrl({ scenario: 'unchecked-open' }),
		]) {
			const reports = hostWith({
				spawners: [{ ...spawnerOf({ engineUrl }), dialecteId: 'core/elsewhere' }],
			})
			const project = uniqueProject()
			spawnFor({ reports, project, dialecteId: 'core/elsewhere' })
			const failed = await reports.next('engine-open-failed')
			expect(failed.key, engineUrl).toBe('PROJECT_DIALECTE_MISMATCH')
			await lockFreeWithin({ project, withinMs: ENGINE_CLOSE_BUDGET_MS + 3_000 })
		}
	})

	it('an engine of another wire → `engine-open-failed` STORE_PROTOCOL_MISMATCH, its worker ended: the project’s lock free', async () => {
		const reports = hostWith({
			spawners: [spawnerOf({ engineUrl: fixtureUrl({ scenario: 'other-wire' }) })],
		})
		const project = uniqueProject()
		spawnFor({ reports, project })
		const failed = await reports.next('engine-open-failed')
		expect(failed.key).toBe('STORE_PROTOCOL_MISMATCH')
		await lockFreeWithin({ project, withinMs: ENGINE_CLOSE_BUDGET_MS })
	})

	it('the project’s lock still held (the engine before letting go) → the spawn waits for it, then opens', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		const project = uniqueProject()
		let releaseHeld: () => void = function releaseNothing() {}
		await new Promise<void>(function holdLock(held) {
			void navigator.locks.request(
				engineLockNameOf({ dialecteId: TEST_DIALECTE.id, project: project }),
				function holdUntilReleased() {
					held()
					return new Promise<void>(function waitForRelease(release) {
						releaseHeld = release
					})
				},
			)
		})
		let opened = false
		void reports.next('engine-opened').then(function markOpened() {
			opened = true
		})
		spawnFor({ reports, project })
		await pause({ ms: 500 })
		expect(opened).toBe(false)
		releaseHeld()
		// the open takes the lock let go: within the engine's own budget, however loaded the machine
		await expect
			.poll(
				function isOpened() {
					return opened
				},
				{ timeout: OPEN_BUDGET_MS, interval: 50 },
			)
			.toBe(true)
	})

	it('an engine that ends on its own → `engine-ended` told', async () => {
		const reports = hostWith({
			spawners: [spawnerOf({ engineUrl: fixtureUrl({ scenario: 'endable' }) })],
		})
		const project = uniqueProject()
		spawnFor({ reports, project })
		await reports.next('engine-opened')
		// posted as is: the worker ends before it could acknowledge an order
		const orders = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
		orders.postMessage({ type: 'end' })
		orders.close()
		const ended = await reports.next('engine-ended')
		expect(ended).toEqual({
			type: 'engine-ended',
			project,
			dialecteId: TEST_DIALECTE.id,
			generation: 1,
		})
	})

	it('a client to adopt for an engine it no longer hosts → `client-adopt-failed`, the port closed', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		const channel = new MessageChannel()
		reports.host.adopt({
			project: uniqueProject(),
			generation: 1,
			adoptionId: 7,
			clientId: 'tab',
			port: channel.port2,
		})
		const failed = await reports.next('client-adopt-failed')
		expect(failed).toEqual({ type: 'client-adopt-failed', adoptionId: 7 })
		channel.port1.close()
	})

	it('a client its engine never adopts → `client-adopt-failed` once the adopt budget has passed, and nothing else', async () => {
		const reports = hostWith({
			spawners: [spawnerOf({ engineUrl: fixtureUrl({ scenario: 'silent-adopt' }) })],
			adoptBudgetMs: SILENT_ENGINE_WAIT_MS,
		})
		const project = uniqueProject()
		spawnFor({ reports, project })
		await reports.next('engine-opened')
		const channel = new MessageChannel()
		let adopted = false
		void reports.next('client-adopted').then(function markAdopted() {
			adopted = true
		})
		const askedAt = performance.now()
		reports.host.adopt({
			project,
			generation: 1,
			adoptionId: 3,
			clientId: 'tab',
			port: channel.port2,
		})
		const failed = await reports.next('client-adopt-failed')
		expect(failed).toEqual({ type: 'client-adopt-failed', adoptionId: 3 })
		expect(performance.now() - askedAt).toBeGreaterThanOrEqual(SILENT_ENGINE_WAIT_MS)
		await pause({ ms: 100 })
		expect(adopted).toBe(false)
		channel.port1.close()
	})

	it('a client gone → the engine told: that port answers no more', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		const project = uniqueProject()
		spawnFor({ reports, project })
		await reports.next('engine-opened')
		const port = await adoptClient({ reports, project, clientId: 'tab' })
		const client = createEngineClient({ port })
		// the engine has released the client before its port is asked anything
		await reports.host.clientGone({ project, generation: 1, clientId: 'tab' })
		const answer = await Promise.race([
			client.api.getDocuments().then(
				function answered() {
					return 'answered'
				},
				function refused() {
					return 'answered'
				},
			),
			pause({ ms: 500 }).then(function silent() {
				return 'silent'
			}),
		])
		expect(answer).toBe('silent')
		client.close({ storeName: project })
	})

	it('released → the engine closed, its lock let go; one deaf to close → ended once the close budget has passed', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		// the deaf engine runs the same dialecte: a host of its own starts it
		const deafReports = hostWith({
			spawners: [spawnerOf({ engineUrl: fixtureUrl({ scenario: 'ignore-close' }) })],
		})
		const project = uniqueProject()
		const deafProject = uniqueProject()
		spawnFor({ reports, project })
		await reports.next('engine-opened')
		spawnFor({ reports: deafReports, project: deafProject })
		await deafReports.next('engine-opened')
		const releasedAt = performance.now()
		reports.host.release({ project, generation: 1 })
		deafReports.host.release({ project: deafProject, generation: 1 })
		await lockFreeWithin({ project, withinMs: ENGINE_CLOSE_BUDGET_MS })
		const deafLockFreeAtOnce = await isEngineLockFree({ project: deafProject })
		expect(deafLockFreeAtOnce).toBe(false)
		await lockFreeWithin({ project: deafProject, withinMs: ENGINE_CLOSE_BUDGET_MS * 2 })
		expect(performance.now() - releasedAt).toBeGreaterThanOrEqual(ENGINE_CLOSE_BUDGET_MS - 50)
	})

	it('every engine ended at once (the page going away) → their locks let go, no `engine-ended` told', async () => {
		const reports = hostWith({ spawners: [spawnerOf()] })
		const project = uniqueProject()
		spawnFor({ reports, project })
		await reports.next('engine-opened')
		let told = false
		void reports.next('engine-ended').then(function markTold() {
			told = true
		})
		reports.host.endAll()
		await lockFreeWithin({ project, withinMs: ENGINE_CLOSE_BUDGET_MS })
		await pause({ ms: 100 })
		expect(told).toBe(false)
	})
})
