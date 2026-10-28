import { ENGINE_LOCK_PREFIX } from '../../engine/engine.constants'
import {
	NEW_POOL_FREE_BYTES,
	OPAQUE_DIRECTORY,
	POOL_CAPACITY,
	POOL_ROOT_DIRECTORY,
	POOL_VFS_NAME,
	PROBE_BACKOFF_MS,
} from './runtime.constants'

import { createDialecteError } from '@/errors'

import type { EngineLockMode } from '../../engine/engine.types'
import type { HeldEngineLock, SyncAccessFileHandle } from './runtime.types'
import type { SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * The project's pool, opened for this engine within `budgetMs`: the origin's private files checked,
 * the engine lock taken, then - inside one try that releases the lock on any failure - every file of
 * an existing pool probed (opened and closed again), or the space a new pool needs checked, and only
 * then the pool installed: sqlite-wasm removes the whole pool directory when its install fails, so it
 * never runs on a file another engine still holds or on too little space.
 */
export async function openPool(params: {
	sqlite3: Sqlite3Static
	project: string
	lock: EngineLockMode
	budgetMs: number
}): Promise<{ pool: SAHPoolUtil; lock: HeldEngineLock }> {
	const { sqlite3, project, lock: mode, budgetMs } = params
	const deadline = performance.now() + budgetMs
	const root = await privateRoot({ project })
	const lock = await takeEngineLock({ project, mode, budgetMs })
	try {
		const files = await poolFilesOf({ root, project })
		if (files.length === 0) await refuseShortSpace({ project, bytes: NEW_POOL_FREE_BYTES })
		else await probePoolFiles({ project, files, deadline })
		const pool = await sqlite3.installOpfsSAHPoolVfs({
			name: POOL_VFS_NAME,
			directory: poolDirectoryOf({ project }),
			initialCapacity: POOL_CAPACITY,
		})
		return { pool, lock }
	} catch (thrown) {
		lock.release()
		throw thrown
	}
}

/**
 * The project's pool gone with its directory, the engine lock held meanwhile: removed by sqlite-wasm
 * when this engine has it installed (`removeVfs`), else straight from the directory; then checked
 * gone, `PROJECT_DESTROY_FAILED` if not (a file another worker holds stays).
 */
export async function destroyPool(params: {
	project: string
	pool: SAHPoolUtil | undefined
}): Promise<void> {
	const { project, pool } = params
	const root = await privateRoot({ project })
	if (pool) await pool.removeVfs()
	else await removeDirectory({ root, project })
	if (await hasPoolDirectory({ root, project })) {
		throw createDialecteError('PROJECT_DESTROY_FAILED', {
			detail: `The files of project "${project}" are still there: another tab or worker may hold one`,
			meta: { project },
		})
	}
}

/** The project's pool directory under the origin's private file system. */
export function poolDirectoryOf(params: { project: string }): string {
	return `${POOL_ROOT_DIRECTORY}/${encodeURIComponent(params.project)}`
}

/**
 * The project's engine lock, held until released: free at once or refused `PROJECT_OPEN_ELSEWHERE`
 * (`if-available`), or waited for within the budget, else `PROJECT_ENGINE_BUSY` (`wait`).
 */
export function takeEngineLock(params: {
	project: string
	mode: EngineLockMode
	budgetMs: number
}): Promise<HeldEngineLock> {
	const { project, mode, budgetMs } = params
	const name = `${ENGINE_LOCK_PREFIX}${project}`
	return new Promise(function requestLock(resolve, reject) {
		let release: () => void = releaseNothing
		const held = new Promise<void>(function holdUntilReleased(done) {
			release = done
		})
		const options: LockOptions =
			mode === 'if-available' ? { ifAvailable: true } : { signal: AbortSignal.timeout(budgetMs) }
		navigator.locks
			.request(name, options, async function holdLock(granted) {
				if (!granted) {
					reject(
						createDialecteError('PROJECT_OPEN_ELSEWHERE', {
							detail: `Project "${project}" is open in another tab or window`,
							meta: { project },
						}),
					)
					return
				}
				resolve({ release })
				await held
			})
			.catch(function refuseNotGranted(thrown: unknown) {
				reject(
					createDialecteError('PROJECT_ENGINE_BUSY', {
						detail: `Project "${project}" was still held by another engine after ${budgetMs} ms`,
						meta: { project, budgetMs },
						cause: thrown instanceof Error ? thrown : undefined,
					}),
				)
			})
	})
}

/**
 * The origin's private file system, or `STORE_UNAVAILABLE` when this browser gives none to the page (a
 * private window) or no synchronous file access to a worker.
 */
async function privateRoot(params: { project: string }): Promise<FileSystemDirectoryHandle> {
	const { project } = params
	const refusal = {
		detail: `Project "${project}" cannot be stored: this browser gives the page no private file system`,
		meta: { project },
	}
	const storage = globalThis.navigator?.storage
	const syncAccess = (
		globalThis.FileSystemFileHandle?.prototype as SyncAccessFileHandle | undefined
	)?.createSyncAccessHandle
	if (typeof storage?.getDirectory !== 'function' || typeof syncAccess !== 'function') {
		throw createDialecteError('STORE_UNAVAILABLE', refusal)
	}
	try {
		return await storage.getDirectory()
	} catch (thrown) {
		throw createDialecteError('STORE_UNAVAILABLE', {
			...refusal,
			cause: thrown instanceof Error ? thrown : undefined,
		})
	}
}

/** The files of the project's pool, none when it has no pool yet (nothing created). */
async function poolFilesOf(params: {
	root: FileSystemDirectoryHandle
	project: string
}): Promise<FileSystemFileHandle[]> {
	const directory = await existingDirectory({
		root: params.root,
		path: [...poolDirectoryOf(params).split('/'), OPAQUE_DIRECTORY],
	})
	if (!directory) return []
	const files: FileSystemFileHandle[] = []
	for await (const handle of directory.values()) {
		if (handle.kind === 'file') files.push(handle as FileSystemFileHandle)
	}
	return files
}

/**
 * Every file of the pool opened and closed again: a file another engine still holds (its lock gone,
 * its handles not yet) is tried again with backoff until the deadline, then `PROJECT_ENGINE_BUSY`
 * (`meta.retriedOn`); a file that cannot be opened for another reason refuses the open
 * (`STORE_CONNECTION_FAILED`), the pool untouched.
 */
async function probePoolFiles(params: {
	project: string
	files: FileSystemFileHandle[]
	deadline: number
}): Promise<void> {
	const { project, files, deadline } = params
	const retriedOn = new Set<string>()
	for (const file of files) {
		for (let attempt = 0; ; attempt += 1) {
			try {
				const handle = await (file as SyncAccessFileHandle).createSyncAccessHandle()
				handle.close()
				break
			} catch (thrown) {
				if (!isBusy({ thrown })) {
					throw createDialecteError('STORE_CONNECTION_FAILED', {
						detail: `File "${file.name}" of project "${project}" cannot be opened`,
						meta: { project, file: file.name },
						cause: thrown instanceof Error ? thrown : undefined,
					})
				}
				retriedOn.add(file.name)
				const wait = PROBE_BACKOFF_MS[Math.min(attempt, PROBE_BACKOFF_MS.length - 1)]!
				if (performance.now() + wait > deadline) {
					throw createDialecteError('PROJECT_ENGINE_BUSY', {
						detail: `Project "${project}" is still held by another engine: its files are busy`,
						meta: { project, retriedOn: [...retriedOn] },
						cause: thrown instanceof Error ? thrown : undefined,
					})
				}
				await new Promise(function waitBeforeRetry(resolve) {
					setTimeout(resolve, wait)
				})
			}
		}
	}
}

/** A file another handle holds: what OPFS answers while a successor's predecessor still closes its handles. */
function isBusy(params: { thrown: unknown }): boolean {
	return (
		params.thrown instanceof DOMException && params.thrown.name === 'NoModificationAllowedError'
	)
}

/**
 * `STORE_QUOTA_EXCEEDED` when the origin has fewer than `bytes` left (a new pool's files, an import's
 * rows): refused before anything is written. A browser that tells no quota is trusted.
 */
export async function refuseShortSpace(params: { project: string; bytes: number }): Promise<void> {
	const { project, bytes } = params
	const { quota, usage = 0 } = await navigator.storage.estimate()
	if (quota === undefined) return
	const available = quota - usage
	if (available >= bytes) return
	throw createDialecteError('STORE_QUOTA_EXCEEDED', {
		detail: `Project "${project}" needs ${bytes} bytes free, ${available} are left`,
		meta: { project, needed: bytes, available },
	})
}

async function removeDirectory(params: {
	root: FileSystemDirectoryHandle
	project: string
}): Promise<void> {
	const parent = await existingDirectory({ root: params.root, path: [POOL_ROOT_DIRECTORY] })
	try {
		await parent?.removeEntry(encodeURIComponent(params.project), { recursive: true })
	} catch {
		// absent already, or a file still held: the check after says which
	}
}

async function hasPoolDirectory(params: {
	root: FileSystemDirectoryHandle
	project: string
}): Promise<boolean> {
	const directory = await existingDirectory({
		root: params.root,
		path: poolDirectoryOf(params).split('/'),
	})
	return directory !== undefined
}

/** The directory at `path` under `root`, never created; undefined when absent. */
async function existingDirectory(params: {
	root: FileSystemDirectoryHandle
	path: string[]
}): Promise<FileSystemDirectoryHandle | undefined> {
	let directory = params.root
	for (const name of params.path) {
		try {
			directory = await directory.getDirectoryHandle(name)
		} catch (thrown) {
			if (thrown instanceof DOMException && thrown.name === 'NotFoundError') return undefined
			throw thrown
		}
	}
	return directory
}

function releaseNothing(): void {}
