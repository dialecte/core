import { CONTRACT_ENGINE_URL } from '../../../contract/store-contract.constants'
import {
	contractFile,
	expectRejectsWith,
	makeDocument,
	makeRecord,
	outcomeOf,
} from '../../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../../contract/store-contract.import-session'
import { sqliteHubSpawner } from '../../adapter/sqlite-hub-spawner'
import { fixtureUrl, isEngineLockFree, TEST_ENGINE_URL } from '../../runtime/runtime.fixtures'
import { ENGINE_WORKER_CASE_TIMEOUT_MS } from '../../runtime/runtime.fixtures.constants'
import { EngineStore } from '../engine-store'
import { startHubConnection } from '../hub/hub-client'
import { serveHub } from '../hub/hub-shell'
import { ENGINE_IDLE_CLOSE_MS } from '../hub/hub.constants'
import { fakePage } from '../hub/hub.fixtures'
import { ENGINE_CLOSE_BUDGET_MS } from './client.constants'
import { createHubConnector } from './hub-connector'
import {
	DESTROY_ASK_BUDGET_MS,
	DESTROY_ASK_INTERVAL_MS,
	DESTROY_ASKS,
	ENGINE_END_SLACK_MS,
	PAST_THE_GRACE_MS,
} from './hub-connector.fixtures.constants'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

import type { HubConnection, HubLifecycleTargets } from '../hub/hub-client.types'
import type { HubShell } from '../hub/hub-shell.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

const SPAWNER = sqliteHubSpawner({
	dialecteId: TEST_DIALECTE.id,
	dialecteVersion: TEST_DIALECTE.version,
	engineUrl: TEST_ENGINE_URL,
})

/** A realm of this page joined to `hub` on a port of its own, closed after the case. */
async function joinHub(params: {
	hub: HubShell
	canStartEngines: boolean
	lifecycle?: HubLifecycleTargets
	engineUrl?: string
}): Promise<HubConnection> {
	const spawner = params.engineUrl ? { ...SPAWNER, engineUrl: params.engineUrl } : SPAWNER
	const connection = await startHubConnection({
		openPort: function newPort() {
			const channel = new MessageChannel()
			params.hub.connect({ port: channel.port2 })
			return { port: channel.port1 }
		},
		topLevel: true,
		spawners: params.canStartEngines ? [spawner] : [],
		holdsLock: true,
		lifecycle: params.lifecycle,
	})
	onTestFinished(connection.close)
	return connection
}

/** A store of the project through the realm, not opened yet; closed after the case. */
function storeThrough(params: {
	connection: HubConnection
	name: string
	dialecteVersion?: string
}): EngineStore {
	const { connection, name, dialecteVersion = TEST_DIALECTE.version } = params
	const store = new EngineStore({
		name,
		connector: createHubConnector({
			name,
			connection,
			dialecteId: TEST_DIALECTE.id,
			dialecteVersion,
			engineUrl: TEST_ENGINE_URL,
		}),
	})
	onTestFinished(function closeStore() {
		store.close()
	})
	return store
}

/**
 * Destroy the store once no other realm is the project's client: each ask awaited to its answer, asked again
 * only on PROJECT_OPEN_ELSEWHERE (another realm's leave on its way), a few times at most.
 */
async function destroyOnceAlone(params: { store: EngineStore }): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		const destroying = params.store.destroy()
		const outcome = await outcomeOf({ promise: destroying, withinMs: DESTROY_ASK_BUDGET_MS })
		if (outcome === 'settled') return
		// an ask still running is let finish first: nothing of it goes on into what comes after
		if (outcome === 'pending') await destroying.catch(ignoreLateAnswer)
		if (outcome !== 'PROJECT_OPEN_ELSEWHERE' || attempt === DESTROY_ASKS) {
			throw new Error(`the destroy answered ${outcome} on ask ${attempt}`)
		}
		await new Promise(function waitAWhile(resolve) {
			setTimeout(resolve, DESTROY_ASK_INTERVAL_MS)
		})
	}
}

function ignoreLateAnswer(): void {}

function uniqueProject(): string {
	return `hub-connector-${crypto.randomUUID()}`
}

describe('a store reaching its project’s engine through the hub', () => {
	it('opened while no page can start the engine → refused PROJECT_ENGINE_UNAVAILABLE; a page that can joins → the next open answered', async () => {
		const hub = serveHub()
		const tab = await joinHub({ hub, canStartEngines: false })
		const project = uniqueProject()
		const store = storeThrough({ connection: tab, name: project })
		await expectRejectsWith({ action: store.open(), key: 'PROJECT_ENGINE_UNAVAILABLE' })
		await joinHub({ hub, canStartEngines: true })
		await store.open()
		const documents = await store.getDocuments()
		expect(documents).toEqual([])
	})

	it('a realm running another version of the dialecte → refused PROJECT_DIALECTE_VERSION_MISMATCH; every later call asks again and is refused the same', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true })
		const project = uniqueProject()
		await storeThrough({ connection: shell, name: project }).open()
		const tab = await joinHub({ hub, canStartEngines: false })
		const other = storeThrough({ connection: tab, name: project, dialecteVersion: '9.9.9' })
		await expectRejectsWith({ action: other.open(), key: 'PROJECT_DIALECTE_VERSION_MISMATCH' })
		await expectRejectsWith({
			action: other.getDocuments(),
			key: 'PROJECT_DIALECTE_VERSION_MISMATCH',
		})
	})

	it('a document one realm registers → read by a store of another realm', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true })
		const tab = await joinHub({ hub, canStartEngines: false })
		const project = uniqueProject()
		const written = storeThrough({ connection: shell, name: project })
		await written.open()
		await written.registerDocument(makeDocument())
		const read = storeThrough({ connection: tab, name: project })
		const documents = await read.getDocuments()
		expect(documents).toEqual([makeDocument()])
	})

	it('its host frozen → a read answered by the next engine, on the same files', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, canStartEngines: true, lifecycle: page })
		const tab = await joinHub({ hub, canStartEngines: true })
		const project = uniqueProject()
		const written = storeThrough({ connection: shell, name: project })
		await written.open()
		await written.registerDocument(makeDocument())
		const read = storeThrough({ connection: tab, name: project })
		await read.open()
		const reading = read.getDocuments()
		page.freeze()
		const documents = await reading
		expect(documents).toEqual([makeDocument()])
		const after = await read.getDocuments()
		expect(after).toEqual([makeDocument()])
	})

	it('opened before the hub answered → it waits for the engine, then answers', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true })
		const store = storeThrough({ connection: shell, name: uniqueProject() })
		const opening = store.open()
		const atOnce = await outcomeOf({ promise: opening, withinMs: 0 })
		expect(atOnce).toBe('pending')
		await opening
		const documents = await store.getDocuments()
		expect(documents).toEqual([])
	})

	it('a commit in flight when its host freezes → refused STORE_ENGINE_LOST host-gone with its id, not made again; its outcome asked of the next engine', async () => {
		const hub = serveHub()
		const page = fakePage()
		const shell = await joinHub({ hub, canStartEngines: true, lifecycle: page })
		const tab = await joinHub({ hub, canStartEngines: true })
		const project = uniqueProject()
		const written = storeThrough({ connection: shell, name: project })
		await written.open()
		await written.registerDocument(makeDocument())
		const store = storeThrough({ connection: tab, name: project })
		await store.open()
		const committing = store.commit({
			documentId: 'doc-1',
			writeId: 'w-frozen',
			creates: [makeRecord({ id: 'r9' })],
			updates: [],
			deletes: [],
			onProgress: function ignoreProgress() {},
		})
		page.freeze()
		const lost = await committing.then(
			function committed() {
				return undefined
			},
			function refused(error: unknown) {
				return toDialecteError(error)
			},
		)
		expect(lost).toMatchObject({
			key: 'STORE_ENGINE_LOST',
			meta: { reason: 'host-gone', writeId: 'w-frozen' },
		})
		// the freeze ends the host's engine before the commit reaches it: nothing applied, nothing made again
		const outcome = await store.getWriteOutcome({ writeId: 'w-frozen' })
		expect(outcome).toBe('not-applied')
		const record = await store.get('r9', 'doc-1')
		expect(record).toBeUndefined()
	})

	it('an import held in one realm → a write through another realm answered meanwhile; released, the import completes: both realms read both documents', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true, engineUrl: CONTRACT_ENGINE_URL })
		const tab = await joinHub({ hub, canStartEngines: false })
		const project = uniqueProject()
		const importer = storeThrough({ connection: shell, name: project })
		await importer.open()
		const hold = holdContractImport()
		const importing = importer.importFile({
			file: contractFile({ body: `<B aB="B0" bB="${hold.value}"/>` }),
			writeId: 'w-held',
		})
		await untilHeld({ hold, importing })
		const writer = storeThrough({ connection: tab, name: project })
		await writer.registerDocument(makeDocument({ id: 'doc-2' }))
		hold.release()
		const imported = await importing
		for (const store of [importer, writer]) {
			const ids = (await store.getDocuments()).map(function idOf(document) {
				return document.id
			})
			expect(ids.toSorted()).toEqual([imported.record.id, 'doc-2'].toSorted())
		}
	})

	it('two stores of the project in one realm → the engine serves them both; the realm leaves with its last one: the engine ends after its grace', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true })
		const project = uniqueProject()
		const first = storeThrough({ connection: shell, name: project })
		const second = storeThrough({ connection: shell, name: project })
		await first.open()
		await second.open()
		first.close()
		await new Promise(function pastTheGrace(resolve) {
			setTimeout(resolve, ENGINE_IDLE_CLOSE_MS + PAST_THE_GRACE_MS)
		})
		const stillServed = await second.getDocuments()
		expect(stillServed).toEqual([])
		second.close()
		await expect
			.poll(
				function engineEnded() {
					return isEngineLockFree({ project })
				},
				{
					timeout: ENGINE_IDLE_CLOSE_MS + ENGINE_CLOSE_BUDGET_MS + ENGINE_END_SLACK_MS,
					interval: 200,
				},
			)
			.toBe(true)
	})

	it('destroyed by the only realm using it, its engine slow to let go → destroyed at the first ask: the fresh worker waits for the lock of the engine the hub just released', async () => {
		const hub = serveHub()
		// an engine deaf to close holds its lock until the close budget has passed
		const shell = await joinHub({
			hub,
			canStartEngines: true,
			engineUrl: fixtureUrl({ scenario: 'ignore-close' }),
		})
		const project = uniqueProject()
		const store = storeThrough({ connection: shell, name: project })
		await store.open()
		await store.registerDocument(makeDocument())
		await store.destroy()
		const next = storeThrough({ connection: shell, name: project })
		const documents = await next.getDocuments()
		expect(documents).toEqual([])
	})

	it('destroyed while another realm uses the project → refused PROJECT_OPEN_ELSEWHERE; alone → destroyed: the next store reads it empty', async () => {
		const hub = serveHub()
		const shell = await joinHub({ hub, canStartEngines: true })
		const tab = await joinHub({ hub, canStartEngines: false })
		const project = uniqueProject()
		const store = storeThrough({ connection: shell, name: project })
		await store.open()
		await store.registerDocument(makeDocument())
		const other = storeThrough({ connection: tab, name: project })
		await other.open()
		await expectRejectsWith({ action: store.destroy(), key: 'PROJECT_OPEN_ELSEWHERE' })
		other.close()
		// the other realm's leave and this destroy cross on two ports: asked again, each ask settled, until the hub has it
		await destroyOnceAlone({ store })
		const next = storeThrough({ connection: shell, name: project })
		const documents = await next.getDocuments()
		expect(documents).toEqual([])
	})
})
