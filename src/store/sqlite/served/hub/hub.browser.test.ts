import {
	CONTRACT_CLIENT_GONE_CHANNEL,
	CONTRACT_ENGINE_URL,
} from '../../../contract/store-contract.constants'
import { contractFile } from '../../../contract/store-contract.fixtures'
import { holdContractImport, untilHeld } from '../../../contract/store-contract.import-session'
import { fixtureUrl, isEngineLockFree, orderFixture } from '../../runtime/runtime.fixtures'
import {
	ENGINE_WORKER_CASE_TIMEOUT_MS,
	FIXTURE_DIALECTE,
} from '../../runtime/runtime.fixtures.constants'
import { engineLockNameOf } from '../engine-lock'
import { ENGINE_IDLE_CLOSE_MS } from './hub.constants'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContractClientGoneNotice } from '../../../contract/store-contract.types'
import type {
	BootRealmParams,
	BoundChildFrame,
	BrowserRealm,
	RealmFrame,
	RealmWindow,
} from './hub.browser.fixtures.types'

vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

const REALM_FIXTURE_URL = new URL('./hub.browser.fixtures.ts', import.meta.url).href
/**
 * Records of the document a case exports one per batch: its export runs seconds (about 5 s on an idle
 * machine), past the moment its realm's removal reaches the engine.
 */
const EXPORTED_RECORDS = 50_000
/** The share of an export's own run within which its id must be free once its realm is removed. */
const EXPORT_ID_FREE_SHARE = 0.5
/** An export shorter than this cannot tell an abort from its own end: the case refuses to judge on it. */
const EXPORT_LONG_ENOUGH_MS = 1_000
/** How long a realm iframe may take to load its module and join the hub. */
const REALM_BOOT_MS = 15_000

/** The realm iframes a case made: removed after it, their locks let go with them. */
const frames: HTMLIFrameElement[] = []

afterEach(function removeFrames() {
	for (const frame of frames.splice(0)) frame.remove()
})

/** A same-origin iframe running a realm of its own, joined to the origin's hub. */
async function realmFrame(params: BootRealmParams): Promise<RealmFrame> {
	const frame = document.createElement('iframe')
	frame.srcdoc = bootDocument({ params })
	document.body.append(frame)
	frames.push(frame)
	const realm = await realmOf({ frame })
	return { frame, realm }
}

/**
 * The document a realm iframe loads: the fixture's module booting the realm. Vitest serves its modules with every
 * `import()` wrapped by its runner, which an iframe has not: the frame gets the pass-through vitest gives a worker
 * (`__vitest_browser_runner__.wrapDynamicImport`, vitest's own name as of vitest 4.1.12: a later version may rename it).
 */
function bootDocument(params: { params: BootRealmParams }): string {
	const boot = JSON.stringify(params.params)
	return `<script>globalThis.__vitest_browser_runner__ = { wrapDynamicImport: (load) => load() }</script><script type="module">import { bootRealm } from '${REALM_FIXTURE_URL}'; window.realmReady = bootRealm(${boot})</script>`
}

/** The realm the iframe's module booted, once it has joined the hub. */
async function realmOf(params: { frame: HTMLIFrameElement }): Promise<BrowserRealm> {
	const realmWindow = await bootStarted(params)
	return realmWindow.realmReady!
}

/** The iframe's window once its module has run (the realm booting). */
function bootStarted(params: { frame: HTMLIFrameElement }): Promise<RealmWindow> {
	return vi.waitFor(
		function moduleRan() {
			const candidate = params.frame.contentWindow as RealmWindow | null
			if (!candidate?.realmReady) throw new Error('the realm has not started booting')
			return candidate
		},
		{ timeout: REALM_BOOT_MS, interval: 25 },
	)
}

/** A child realm iframe bound to `parent` through a port the parent makes; its unbind for the case. */
async function boundChildFrame(params: {
	parent: BrowserRealm
	storageRefused?: boolean
}): Promise<BoundChildFrame> {
	const frame = document.createElement('iframe')
	frame.srcdoc = bootDocument({
		params: { canStartEngines: false, bound: true, storageRefused: params.storageRefused },
	})
	document.body.append(frame)
	frames.push(frame)
	// posted once its module runs: it listens for the port from then on
	const booting = await bootStarted({ frame })
	const handle = params.parent.createHubPort()
	frame.contentWindow!.postMessage({ type: 'hub-port', port: handle.port }, '*', [handle.port])
	const realm = await booting.realmReady!
	return { frame, realm, unbind: handle.unbind }
}

/** A file of one record of the session's tag, its import held by `hold` once it reaches the session. */
function heldFile(params: { holdValue: string }): File {
	return contractFile({ body: `<B aB="B0" bB="${params.holdValue}"/>` })
}

/** Why a call of a realm iframe lost its engine (`STORE_CONNECTION_LOST`'s `meta.reason`), or its key otherwise. */
async function lostReasonOf(params: { promise: Promise<unknown> }): Promise<unknown> {
	try {
		await params.promise
		return 'resolved'
	} catch (thrown) {
		const carried = (
			thrown as { cause?: { key?: unknown; meta?: { reason?: unknown } } } | undefined
		)?.cause
		return carried?.key === 'STORE_CONNECTION_LOST' ? carried.meta?.reason : carried?.key
	}
}

/**
 * An export under `exportId`, asked again while the engine refuses it as running (`ASSERTION_FAILED`) -
 * until `withinMs` has passed: then the last answer, whatever it is.
 */
async function exportOnceFree(params: {
	realm: BrowserRealm
	project: string
	documentId: string
	exportId: string
	withinMs: number
}): Promise<number | string> {
	const { realm, project, documentId, exportId, withinMs } = params
	const deadline = performance.now() + withinMs
	for (;;) {
		const answer = await realm.exportUnder({ project, documentId, exportId })
		if (answer !== 'ASSERTION_FAILED' || performance.now() >= deadline) return answer
		await new Promise(function askAgainSoon(resolve) {
			setTimeout(resolve, 200)
		})
	}
}

/**
 * Once a contract engine has been told the client `clientId` is gone and has aborted its imports: a held import of a
 * client removed is released only then, or it may complete first.
 */
function clientGoneSeen(params: { clientId: string }): Promise<void> {
	const channel = new BroadcastChannel(CONTRACT_CLIENT_GONE_CHANNEL)
	return new Promise(function waitForNotice(resolve) {
		channel.onmessage = function hearNotice(event: MessageEvent<ContractClientGoneNotice>) {
			if (event.data.clientId !== params.clientId) return
			channel.close()
			resolve()
		}
	})
}

/** The client id of what holds the project's engine lock now (the engine's worker), if anything does. */
async function engineLockHolder(params: { project: string }): Promise<string | undefined> {
	const { held = [] } = await navigator.locks.query()
	return held.find(function isEngineLock(lock) {
		return (
			lock.name ===
			engineLockNameOf({ dialecteId: FIXTURE_DIALECTE.dialecteId, project: params.project })
		)
	})?.clientId
}

function uniqueProject(): string {
	return `hub-browser-${crypto.randomUUID()}`
}

/**
 * What a call of a realm iframe settled with: `resolved`, or the key it was refused with - read from the
 * structured error it carries, an `Error` of that realm (not an instance of this one's).
 */
async function keyOf(params: { promise: Promise<unknown> }): Promise<string | undefined> {
	try {
		await params.promise
		return 'resolved'
	} catch (thrown) {
		const carried = (thrown as { cause?: { key?: unknown } } | undefined)?.cause
		return typeof carried?.key === 'string' ? carried.key : String(thrown)
	}
}

describe('the hub across realms of the page', () => {
	it('a commit in one realm → its record read by two others within 2 s', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		const second = await realmFrame({ canStartEngines: false })
		const third = await realmFrame({ canStartEngines: false })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		await second.realm.recordIds({ project, documentId: 'doc-1' })
		await third.realm.recordIds({ project, documentId: 'doc-1' })
		const committedAt = performance.now()
		await host.realm.commitRecord({ project, documentId: 'doc-1', id: 'r1' })
		await vi.waitFor(
			async function seenByBoth() {
				const secondRealmRecordIds = await second.realm.recordIds({ project, documentId: 'doc-1' })
				expect(secondRealmRecordIds).toEqual(['r1'])
				const thirdRealmRecordIds = await third.realm.recordIds({ project, documentId: 'doc-1' })
				expect(thirdRealmRecordIds).toEqual(['r1'])
			},
			{ timeout: 2_000, interval: 50 },
		)
		expect(performance.now() - committedAt).toBeLessThan(2_000)
	})

	it('the host iframe removed mid-session → the others keep working: they read and write on the next engine', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		const other = await realmFrame({ canStartEngines: true })
		const third = await realmFrame({ canStartEngines: false })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const otherRealmDocumentIds = await other.realm.documentIds({ project })
		expect(otherRealmDocumentIds).toEqual(['doc-1'])
		host.frame.remove()
		await vi.waitFor(
			async function servedAgain() {
				const documentIds = await other.realm.documentIds({ project })
				expect(documentIds).toEqual(['doc-1'])
			},
			{ timeout: 10_000, interval: 100 },
		)
		await other.realm.registerDocument({ project, id: 'doc-2' })
		await vi.waitFor(
			async function seenByTheThird() {
				const thirdRealmDocumentIds = await third.realm.documentIds({ project })
				expect(thirdRealmDocumentIds).toEqual(['doc-1', 'doc-2'])
			},
			{ timeout: 10_000, interval: 100 },
		)
	})

	it('a change in one realm → told to a realm only listening, and to a child bound through a port, as another’s', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		const listening = await realmFrame({ canStartEngines: false })
		const child = await boundChildFrame({ parent: listening.realm })
		await listening.realm.listen({ project })
		await child.realm.listen({ project })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const told = ['init-empty-document doc-1 other']
		await vi.waitFor(
			function toldToBoth() {
				expect(listening.realm.heard({ project })).toEqual(told)
				expect(child.realm.heard({ project })).toEqual(told)
			},
			{ timeout: 10_000, interval: 100 },
		)
	})

	it('the host iframe removed, a realm only listening → it reaches the next engine, told to read again; the next change told to it', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		const listening = await realmFrame({ canStartEngines: true })
		const writer = await realmFrame({ canStartEngines: false })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		await listening.realm.listen({ project })
		host.frame.remove()
		await vi.waitFor(
			function toldToReadAgain() {
				expect(listening.realm.heard({ project })).toEqual(['resync'])
			},
			{ timeout: 10_000, interval: 100 },
		)
		await writer.realm.registerDocument({ project, id: 'doc-2' })
		await vi.waitFor(
			function toldTheChange() {
				expect(listening.realm.heard({ project })).toEqual([
					'resync',
					'init-empty-document doc-2 other',
				])
			},
			{ timeout: 10_000, interval: 100 },
		)
	})

	it('a child bound through a port whose private file system is refused (a sandboxed frame) → a project on sqlite opened through the page’s engine, and destroyed by the page for it', async () => {
		const { realm: page } = await realmFrame({ canStartEngines: true })
		const { realm: child } = await boundChildFrame({ parent: page, storageRefused: true })
		const project = uniqueProject()
		const childRegisteredIds = await child.registerThroughSqlite({ project, id: 'doc-1' })
		expect(childRegisteredIds).toEqual(['doc-1'])
		const pageDocumentIds = await page.documentIds({ project })
		expect(pageDocumentIds).toEqual(['doc-1'])
		page.closeStore({ project })
		await vi.waitFor(
			async function destroyedOnceClosed() {
				const childDestroyOutcome = await child.destroyThroughSqlite({ project })
				expect(childDestroyOutcome).toBe('destroyed')
			},
			{ timeout: 10_000, interval: 200 },
		)
		// the project made again, empty: the document of before is gone
		const registeredIds = await child.registerThroughSqlite({ project, id: 'doc-2' })
		expect(registeredIds).toEqual(['doc-2'])
	})

	it('a child bound through a port, able to store but with no engine registered in it → a project on sqlite opened through the page’s engine, and its files deleted by a view that can store', async () => {
		const { realm: page } = await realmFrame({ canStartEngines: true })
		const { realm: child } = await boundChildFrame({ parent: page })
		const project = uniqueProject()
		const registered = await child.registerThroughSqlite({ project, id: 'doc-1' })
		expect(registered).toEqual(['doc-1'])
		const hosted = await page.documentIds({ project })
		expect(hosted).toEqual(['doc-1'])
		page.closeStore({ project })
		await vi.waitFor(
			async function destroyedOnceClosed() {
				const destroyed = await child.destroyThroughSqlite({ project })
				expect(destroyed).toBe('destroyed')
			},
			{ timeout: 10_000, interval: 200 },
		)
		// the project made again, empty: the document of before is gone
		const madeAgain = await child.registerThroughSqlite({ project, id: 'doc-2' })
		expect(madeAgain).toEqual(['doc-2'])
	})

	it('a realm joined on its own whose private file system is refused → a project on sqlite refused STORE_UNAVAILABLE, though another realm could host it', async () => {
		await realmFrame({ canStartEngines: true })
		const { realm } = await realmFrame({ canStartEngines: false, storageRefused: true })
		const realmRegisteredIds = await realm.registerThroughSqlite({
			project: uniqueProject(),
			id: 'doc-1',
		})
		expect(realmRegisteredIds).toBe('STORE_UNAVAILABLE')
	})

	it('a realm iframe reloaded → it joins again under a new realm id', async () => {
		const { frame, realm } = await realmFrame({ canStartEngines: true })
		const before = realm.realmId()
		const reloaded = new Promise(function waitForReload(resolve) {
			frame.addEventListener('load', resolve, { once: true })
		})
		frame.contentWindow!.location.reload()
		await reloaded
		const again = await realmOf({ frame })
		expect(again.realmId()).not.toBe(before)
	})

	it('a realm running another version of the dialecte → refused PROJECT_DIALECTE_VERSION_MISMATCH', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const other = await realmFrame({ canStartEngines: false, dialecteVersion: '0.0.0-other' })
		const key = await keyOf({ promise: other.realm.documentIds({ project }) })
		expect(key).toBe('PROJECT_DIALECTE_VERSION_MISMATCH')
	})

	it('a realm that is not the host removed during its own import → the import aborted: its document gone in every realm', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true, engineUrl: CONTRACT_ENGINE_URL })
		const importer = await realmFrame({ canStartEngines: false })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const hold = holdContractImport()
		const importing = importer.realm.importHeld({
			project,
			writeId: 'w-gone',
			file: heldFile({ holdValue: hold.value }),
		})
		await untilHeld({ hold, importing })
		const gone = clientGoneSeen({ clientId: importer.realm.realmId() })
		importer.frame.remove()
		await gone
		hold.release()
		await vi.waitFor(
			async function importGone() {
				const hostRealmDocumentIds = await host.realm.documentIds({ project })
				expect(hostRealmDocumentIds).toEqual(['doc-1'])
			},
			{ timeout: 10_000, interval: 100 },
		)
		const hostRealmWriteOutcome = await host.realm.writeOutcome({ project, writeId: 'w-gone' })
		expect(hostRealmWriteOutcome).toBe('not-applied')
	})

	it('a child bound by its page through a port, unbound during its import → the import aborted: its document gone in every realm', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true, engineUrl: CONTRACT_ENGINE_URL })
		const child = await boundChildFrame({ parent: host.realm })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const hold = holdContractImport()
		const importing = child.realm.importHeld({
			project,
			writeId: 'w-unbound',
			file: heldFile({ holdValue: hold.value }),
		})
		void importing.catch(function lostWithItsBinding() {})
		await untilHeld({ hold, importing })
		const gone = clientGoneSeen({ clientId: child.realm.realmId() })
		child.unbind()
		await gone
		hold.release()
		await vi.waitFor(
			async function importGone() {
				const hostRealmDocumentIds = await host.realm.documentIds({ project })
				expect(hostRealmDocumentIds).toEqual(['doc-1'])
			},
			{ timeout: 10_000, interval: 100 },
		)
		const hostRealmWriteOutcome = await host.realm.writeOutcome({ project, writeId: 'w-unbound' })
		expect(hostRealmWriteOutcome).toBe('not-applied')
	})

	it('a realm whose only engine worker is of another origin → it hosts nothing: PROJECT_ENGINE_UNAVAILABLE; a srcdoc realm with a same-origin one hosts the project', async () => {
		const project = uniqueProject()
		const foreign = await realmFrame({
			canStartEngines: true,
			engineUrl: 'https://engine.invalid/dialecte.worker.js',
		})
		const foreignRealmDocumentIdsRefusalKey = await keyOf({
			promise: foreign.realm.documentIds({ project }),
		})
		expect(foreignRealmDocumentIdsRefusalKey).toBe('PROJECT_ENGINE_UNAVAILABLE')
		const local = await realmFrame({ canStartEngines: true })
		await vi.waitFor(
			async function hostedNow() {
				const localRealmDocumentIds = await local.realm.documentIds({ project })
				expect(localRealmDocumentIds).toEqual([])
			},
			{ timeout: 10_000, interval: 100 },
		)
	})

	it('the last realm using the project lets it go → its engine ends once the idle grace has passed', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const lockHeld = await isEngineLockFree({ project })
		expect(lockHeld).toBe(false)
		const releasedAt = performance.now()
		host.realm.closeStore({ project })
		await vi.waitFor(
			async function engineEnded() {
				const lockFree = await isEngineLockFree({ project })
				expect(lockFree).toBe(true)
			},
			{ timeout: ENGINE_IDLE_CLOSE_MS + 10_000, interval: 200 },
		)
		expect(performance.now() - releasedAt).toBeGreaterThanOrEqual(ENGINE_IDLE_CLOSE_MS - 200)
	})

	it('the host’s pagehide during an import another realm started → that realm refused STORE_CONNECTION_LOST host-gone, the outcome not-applied, nothing of the file left, its File still usable', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true, engineUrl: CONTRACT_ENGINE_URL })
		const importer = await realmFrame({ canStartEngines: true, engineUrl: CONTRACT_ENGINE_URL })
		await host.realm.documentIds({ project })
		const hold = holdContractImport()
		const file = heldFile({ holdValue: hold.value })
		const importing = importer.realm.importHeld({ project, writeId: 'w-hidden', file })
		const lost = lostReasonOf({ promise: importing })
		await untilHeld({ hold, importing })
		host.realm.lifecycle({ type: 'pagehide', persisted: false })
		const lostReason = await lost
		expect(lostReason).toBe('host-gone')
		hold.release()
		const importerRealmWriteOutcome = await importer.realm.writeOutcome({
			project,
			writeId: 'w-hidden',
		})
		expect(importerRealmWriteOutcome).toBe('not-applied')
		const importerRealmDocumentIds = await importer.realm.documentIds({ project })
		expect(importerRealmDocumentIds).toEqual([])
		const again = await importer.realm.importHeld({ project, writeId: 'w-again', file })
		const documentIds = await importer.realm.documentIds({ project })
		expect(documentIds).toEqual([again.documentId])
	})

	for (const [away, back] of [
		['freeze', 'resume'],
		['pagehide', 'pageshow'],
	] as const) {
		it(`the host’s ${away} (persisted) → the other realm served by the next engine; its ${back} → it joins again under a new realm id and reads the project`, async () => {
			const project = uniqueProject()
			const host = await realmFrame({ canStartEngines: true })
			const other = await realmFrame({ canStartEngines: true })
			await host.realm.registerDocument({ project, id: 'doc-1' })
			const otherRealmDocumentIds = await other.realm.documentIds({ project })
			expect(otherRealmDocumentIds).toEqual(['doc-1'])
			const before = host.realm.realmId()
			const firstEngine = await engineLockHolder({ project })
			expect(firstEngine).toBeDefined()
			host.realm.lifecycle({ type: away, persisted: true })
			// handed over: another engine worker holds the project, and the other realm reads through it
			await vi.waitFor(
				async function servedByTheNext() {
					const holder = await engineLockHolder({ project })
					expect(holder).toBeDefined()
					expect(holder).not.toBe(firstEngine)
					const documentIds = await other.realm.documentIds({ project })
					expect(documentIds).toEqual(['doc-1'])
				},
				{ timeout: 10_000, interval: 100 },
			)
			host.realm.lifecycle({ type: back, persisted: true })
			await vi.waitFor(
				async function backOnTheProject() {
					const hostRealmDocumentIds = await host.realm.documentIds({ project })
					expect(hostRealmDocumentIds).toEqual(['doc-1'])
				},
				{ timeout: 10_000, interval: 100 },
			)
			expect(host.realm.realmId()).not.toBe(before)
		})
	}

	it('a child bound to a page that freezes → its call refused STORE_CONNECTION_LOST realm-dropped; the page resumed binds it again: it reads the project', async () => {
		const project = uniqueProject()
		const page = await realmFrame({ canStartEngines: true })
		const child = await boundChildFrame({ parent: page.realm })
		await page.realm.registerDocument({ project, id: 'doc-1' })
		const childRealmDocumentIds = await child.realm.documentIds({ project })
		expect(childRealmDocumentIds).toEqual(['doc-1'])
		page.realm.rebindOnRejoin({ child: child.frame.contentWindow! })
		page.realm.lifecycle({ type: 'freeze' })
		await vi.waitFor(
			async function childDropped() {
				const childRealmDocumentIdsLostReason = await lostReasonOf({
					promise: child.realm.documentIds({ project }),
				})
				expect(childRealmDocumentIdsLostReason).toBe('realm-dropped')
			},
			{ timeout: 10_000, interval: 100 },
		)
		page.realm.lifecycle({ type: 'resume' })
		await vi.waitFor(
			async function boundAgain() {
				const documentIds = await child.realm.documentIds({ project })
				expect(documentIds).toEqual(['doc-1'])
			},
			{ timeout: 10_000, interval: 100 },
		)
	})

	it('a realm removed during its own export → the export aborted in the engine: an export under its id is not refused', async () => {
		const project = uniqueProject()
		const host = await realmFrame({ canStartEngines: true })
		const exporter = await realmFrame({ canStartEngines: false })
		const { documentId } = await host.realm.importHeld({
			project,
			writeId: 'w-large',
			file: contractFile({ body: '<B aB="B0" bB="b"/>'.repeat(EXPORTED_RECORDS) }),
		})
		// how long the export runs on this machine, uninterrupted: the abort must free its id well within it
		const controlStartedAt = performance.now()
		const control = await host.realm.exportUnder({ project, documentId, exportId: 'e-control' })
		const exportMs = performance.now() - controlStartedAt
		expect(typeof control).toBe('number')
		expect(exportMs).toBeGreaterThan(EXPORT_LONG_ENOUGH_MS)
		const firstBatch = new Promise<void>(function waitForFirstBatch(resolve) {
			void exporter.realm.exportUnder({
				project,
				documentId,
				exportId: 'e-gone',
				onFirstProgress: resolve,
			})
		})
		await firstBatch
		exporter.frame.remove()
		const answer = await exportOnceFree({
			realm: host.realm,
			project,
			documentId,
			exportId: 'e-gone',
			withinMs: exportMs * EXPORT_ID_FREE_SHARE,
		})
		expect(typeof answer).toBe('number')
		await host.realm.destroyProject({ project })
	})

	it('a read the host’s engine holds when its realm ends → answered by the next engine, on the same files', async () => {
		const project = uniqueProject()
		// the host's engine answers until the case mutes it; the reader's is a plain one
		const host = await realmFrame({
			canStartEngines: true,
			engineUrl: fixtureUrl({ scenario: 'mute-clients' }),
		})
		const reader = await realmFrame({ canStartEngines: true })
		await host.realm.registerDocument({ project, id: 'doc-1' })
		const readerRealmDocumentIds = await reader.realm.documentIds({ project })
		expect(readerRealmDocumentIds).toEqual(['doc-1'])
		await orderFixture({ order: { type: 'mute-clients' } })
		// never answered by the host's engine: only the next one, the read made again, answers it
		const reading = reader.realm.documentIds({ project })
		host.frame.remove()
		const readDocumentIds = await reading
		expect(readDocumentIds).toEqual(['doc-1'])
	})
})
