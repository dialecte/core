import { createEngineClient } from '../../engine/client/engine-client'
import { createEngineControl } from '../../engine/client/engine-control'
import { ENGINE_LOCK_PREFIX } from '../../engine/engine.constants'
import { SQLITE_WASM_URL } from '../sqlite-wasm-url'
import { poolDirectoryOf } from './install-pool'
import { OPAQUE_DIRECTORY, POOL_FILE_HEADER } from './runtime.constants'

import type { EngineControl } from '../../engine/client/client.types'
import type { EngineApi, EngineLockMode } from '../../engine/engine.types'
import type { RuntimeFixtureScenario } from './runtime.fixtures.types'
import type { SqliteEngineSettings } from './runtime.types'

/** The engine of core's test dialecte, as a dialecte's worker entry serves it. */
export const TEST_ENGINE_URL = new URL('../../../test/test-dialecte.worker.ts', import.meta.url)
	.href

/** The runtime's fixture worker on the platform a scenario shapes. */
export function fixtureUrl(params: { scenario: RuntimeFixtureScenario }): string {
	const url = new URL('./runtime.fixtures.worker.ts', import.meta.url)
	url.searchParams.set('scenario', params.scenario)
	return url.href
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

/** The open message of a project. */
export function openMessage(params: {
	project: string
	lock?: EngineLockMode
	budgetMs?: number
}): {
	type: 'open'
	project: string
	lock: EngineLockMode
	budgetMs: number
	perf: boolean
	settings: SqliteEngineSettings
} {
	const { project, lock = 'if-available', budgetMs = 10_000 } = params
	return {
		type: 'open',
		project,
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
}): Promise<{ exists: boolean; files: number }> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY]) {
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
}): Promise<Record<string, string>> {
	let directory = await navigator.storage.getDirectory()
	for (const name of [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY]) {
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
	for (const name of [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY]) {
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
	for (const name of [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY]) {
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
	const name = `${ENGINE_LOCK_PREFIX}${params.project}`
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
export async function holdEngineLock(params: { project: string }): Promise<() => void> {
	let release: () => void = releaseNothing
	await new Promise<void>(function waitUntilGranted(granted) {
		void navigator.locks.request(
			`${ENGINE_LOCK_PREFIX}${params.project}`,
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
	const answer = function nextAnswer(): Promise<{ type: string; file?: string }> {
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
export async function removePoolDirectory(params: { project: string }): Promise<void> {
	const root = await navigator.storage.getDirectory()
	try {
		const parent = await root.getDirectoryHandle(poolDirectoryOf(params).split('/')[0]!)
		await parent.removeEntry(encodeURIComponent(params.project), { recursive: true })
	} catch {
		// nothing there
	}
}

/** A byte as two hexadecimal digits. */
function hexOf(byte: number): string {
	return byte.toString(16).padStart(2, '0')
}

function releaseNothing(): void {}
