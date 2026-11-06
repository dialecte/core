import { createEngineClient } from '../../engine/client/engine-client'
import { createEngineControl } from '../../engine/client/engine-control'
import { engineLockNameOf } from '../../engine/project-key'
import { SQLITE_WASM_URL } from '../sqlite-wasm-url'
import { poolDirectoryOf } from './install-pool'
import { OPAQUE_DIRECTORY, POOL_FILE_HEADER } from './runtime.constants'
import { FIXTURE_DIALECTE, RUNTIME_FIXTURE_CHANNEL } from './runtime.fixtures.constants'

import type { EngineControl } from '../../engine/client/client.types'
import type { EngineApi, EngineLockMode } from '../../engine/engine.types'
import type {
	RuntimeFixtureNotice,
	RuntimeFixtureOrder,
	RuntimeFixtureScenario,
} from './runtime.fixtures.types'
import type { SqliteEngineSettings } from './runtime.types'

/** The engine of core's test dialecte, as a dialecte's worker entry serves it. */
export const TEST_ENGINE_URL = new URL('../../../test/test-dialecte.worker.ts', import.meta.url)
	.href

/** Whether the project's engine lock is free now (taken and let go at once when it is). */
export function isEngineLockFree(params: {
	project: string
	dialecteId?: string
}): Promise<boolean> {
	return navigator.locks.request(
		engineLockNameOf(fixtureAddress(params)),
		{ ifAvailable: true },
		function grantedOrNot(lock) {
			return lock !== null
		},
	)
}

/** The runtime's fixture worker on the platform a scenario shapes. */
export function fixtureUrl(params: { scenario: RuntimeFixtureScenario }): string {
	const url = new URL('./runtime.fixtures.worker.ts', import.meta.url)
	url.searchParams.set('scenario', params.scenario)
	return url.href
}

/** The fixture's engine workers given an order; resolves once one of them has taken it. */
export async function orderFixture(params: { order: RuntimeFixtureOrder }): Promise<void> {
	const { order } = params
	const listener = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	const acknowledged = new Promise<void>(function waitForAck(resolve) {
		listener.addEventListener('message', function hear(event: MessageEvent<RuntimeFixtureNotice>) {
			if (event.data.type === 'ack' && event.data.of === order.type) resolve()
		})
	})
	const channel = new BroadcastChannel(RUNTIME_FIXTURE_CHANNEL)
	channel.postMessage(order)
	channel.close()
	await acknowledged
	listener.close()
}

/** An XML file of a fixture dialecte: `body` inside the root of its default namespace. */
export function fixtureFile(params: { namespaceUri: string; body: string }): File {
	return new File([`<Root xmlns="${params.namespaceUri}">${params.body}</Root>`], 'fixture.xml', {
		type: 'text/xml',
	})
}

/** A project name of its own. */
export function uniqueProject(): string {
	return `runtime-${crypto.randomUUID()}`
}

/** An engine worker the case drives through its control messages; `end` terminates it. */
export function startEngineWorker(params: { url?: string } = {}): {
	worker: Worker
	control: EngineControl
	end: () => void
} {
	const worker = new Worker(params.url ?? TEST_ENGINE_URL, { type: 'module' })
	return {
		worker,
		control: createEngineControl({ worker }),
		end: function endWorker() {
			worker.terminate()
		},
	}
}

/** The open message of a project of core's test dialecte (unless another is asked). */
export function openMessage(params: {
	project: string
	dialecteId?: string
	dialecteVersion?: string
	lock?: EngineLockMode
	budgetMs?: number
}): {
	type: 'open'
	project: string
	dialecteId: string
	dialecteVersion: string
	lock: EngineLockMode
	budgetMs: number
	perf: boolean
	settings: SqliteEngineSettings
} {
	const {
		project,
		dialecteId = FIXTURE_DIALECTE.dialecteId,
		dialecteVersion = FIXTURE_DIALECTE.dialecteVersion,
		lock = 'if-available',
		budgetMs = 10_000,
	} = params
	return {
		type: 'open',
		project,
		dialecteId,
		dialecteVersion,
		settings: { wasmUrl: SQLITE_WASM_URL },
		lock,
		budgetMs,
		perf: false,
	}
}

/** A client of the engine through a port of its own, adopted under `clientId`. */
export async function clientOf(params: {
	control: EngineControl
	clientId: string
}): Promise<EngineApi> {
	const { control, clientId } = params
	const channel = new MessageChannel()
	await control.request({
		message: { type: 'adopt-client', clientId, port: channel.port2 },
		expect: 'adopted',
		transfer: [channel.port2],
	})
	return createEngineClient({ port: channel.port1 }).api
}

/** What the private file system holds of the project's pool: its directory, and how many pool files. */
export async function poolState(params: {
	project: string
	dialecteId?: string
}): Promise<{ exists: boolean; files: number }> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(fixtureAddress(params)).split('/'), OPAQUE_DIRECTORY]) {
		try {
			directory = await directory.getDirectoryHandle(name)
		} catch {
			return { exists: name === OPAQUE_DIRECTORY, files: 0 }
		}
	}
	let files = 0
	for await (const handle of directory.values()) if (handle.kind === 'file') files += 1
	return { exists: true, files }
}

/**
 * The SHA-256 of each file of the project's pool, by file name (hex): what a case compares to say the pool
 * was kept byte for byte; none when the project has no pool files.
 */
export async function poolFileDigests(params: {
	project: string
	dialecteId?: string
}): Promise<Record<string, string>> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(fixtureAddress(params)).split('/'), OPAQUE_DIRECTORY]) {
		try {
			directory = await directory.getDirectoryHandle(name)
		} catch (thrown) {
			if (thrown instanceof DOMException && thrown.name === 'NotFoundError') return {}
			throw thrown
		}
	}
	const digests: Record<string, string> = {}
	for await (const handle of directory.values()) {
		if (handle.kind !== 'file') continue
		const file = await (handle as FileSystemFileHandle).getFile()
		const bytes = await file.arrayBuffer()
		const digest = await crypto.subtle.digest('SHA-256', bytes)
		digests[handle.name] = [...new Uint8Array(digest)].map(hexOf).join('')
	}
	return digests
}

/**
 * The database file's header damaged in the project's pool, its pages kept: its digest overwritten, or the whole head
 * (path, flags, digest) blanked - as a disk or another program may leave it. The database is the largest file: the
 * journal (TRUNCATE mode) keeps its header only.
 */
export async function damageDatabaseHeader(params: {
	project: string
	damage: 'digest' | 'blank'
}): Promise<void> {
	const { damage } = params
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(fixtureAddress(params)).split('/'), OPAQUE_DIRECTORY]) {
		directory = await directory.getDirectoryHandle(name)
	}
	let database: { handle: FileSystemFileHandle; size: number } | undefined
	for await (const handle of directory.values()) {
		if (handle.kind !== 'file') continue
		const file = await (handle as FileSystemFileHandle).getFile()
		if (!database || file.size > database.size) {
			database = { handle: handle as FileSystemFileHandle, size: file.size }
		}
	}
	const writable = await database!.handle.createWritable({ keepExistingData: true })
	await writable.write(
		damage === 'digest'
			? {
					type: 'write',
					position: POOL_FILE_HEADER.digestOffset,
					data: new Uint8Array(POOL_FILE_HEADER.digestBytes).fill(0xff),
				}
			: { type: 'write', position: 0, data: new Uint8Array(POOL_FILE_HEADER.headBytes) },
	)
	await writable.close()
}

/**
 * The project's pool made of blank files of the given sizes, no database: what an install or a creation that ended
 * early leaves (a blank header each, or a file not yet written).
 */
export async function makeBlankPool(params: { project: string; sizes: number[] }): Promise<void> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(fixtureAddress(params)).split('/'), OPAQUE_DIRECTORY]) {
		directory = await directory.getDirectoryHandle(name, { create: true })
	}
	for (const [index, size] of params.sizes.entries()) {
		const handle = await directory.getFileHandle(`blank${index}`, { create: true })
		const writable = await handle.createWritable()
		await writable.write(new Uint8Array(size))
		await writable.close()
	}
}

/** How many realms hold, and how many wait for, the project's engine lock across the origin. */
export async function engineLockQueue(params: {
	project: string
}): Promise<{ held: number; pending: number }> {
	const name = engineLockNameOf(fixtureAddress(params))
	const { held = [], pending = [] } = await navigator.locks.query()
	return {
		held: held.filter(isEngineLock).length,
		pending: pending.filter(isEngineLock).length,
	}

	function isEngineLock(lock: LockInfo): boolean {
		return lock.name === name
	}
}

/** The project's engine lock held by the page until the returned release (a no-op once released). */
export async function holdEngineLock(params: {
	project: string
	dialecteId?: string
}): Promise<() => void> {
	let release: () => void = releaseNothing
	await new Promise<void>(function waitUntilGranted(granted) {
		void navigator.locks.request(
			engineLockNameOf(fixtureAddress(params)),
			async function holdUntilReleased() {
				granted()
				await new Promise<void>(function waitForRelease(done) {
					release = done
				})
			},
		)
	})
	return function releaseLock() {
		release()
	}
}

/** A worker holding one file of the project's pool, as an engine that ended may still do; `release` lets it go. */
export async function holdPoolFile(params: {
	project: string
}): Promise<{ file: string; release: () => Promise<void> }> {
	const worker = new Worker(fixtureUrl({ scenario: 'holder' }), { type: 'module' })
	function answer(): Promise<{ type: string; file?: string }> {
		return new Promise(function waitForAnswer(resolve) {
			worker.addEventListener('message', (event) => resolve(event.data), { once: true })
		})
	}
	const held = answer()
	worker.postMessage({ type: 'hold', project: params.project })
	const { file } = await held
	let gone = false
	return {
		file: file!,
		release: async function release() {
			if (gone) return
			gone = true
			const released = answer()
			worker.postMessage({ type: 'release' })
			await released
			worker.terminate()
		},
	}
}

/** A project's pool directory removed from the page, whatever it holds: a case cleans up after itself. */
export async function removePoolDirectory(params: {
	project: string
	dialecteId?: string
}): Promise<void> {
	const root = await navigator.storage.getDirectory()
	try {
		const path = poolDirectoryOf(fixtureAddress(params)).split('/')
		const entry = path.pop()!
		let parent = root
		for (const name of path) parent = await parent.getDirectoryHandle(name)
		await parent.removeEntry(entry, { recursive: true })
	} catch {
		// nothing there
	}
}

/** A fixture's project as its engine finds it: core's test dialecte unless another is named. */
function fixtureAddress(params: { project: string; dialecteId?: string }): {
	dialecteId: string
	project: string
} {
	return { dialecteId: params.dialecteId ?? FIXTURE_DIALECTE.dialecteId, project: params.project }
}

/** A byte as two hexadecimal digits. */
function hexOf(byte: number): string {
	return byte.toString(16).padStart(2, '0')
}

function releaseNothing(): void {}
