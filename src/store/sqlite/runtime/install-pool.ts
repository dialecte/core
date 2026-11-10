import { projectKeyOf } from '../../project-key'
import { refuseUnnamableProject } from '../../project-name'
import { refuseOtherCreation } from '../served/creation-refusal'
import { engineLockNameOf } from '../served/engine-lock'
import { SQLITE_ERRORS } from '../sqlite-errors.constants'
import { classifyPool } from './pool-header'
import {
	NEW_POOL_FREE_BYTES,
	OUT_OF_SPACE_BYTES,
	OPAQUE_DIRECTORY,
	POOL_CAPACITY,
	POOL_FILE_HEADER,
	POOL_ROOT_DIRECTORY,
	POOL_VFS_NAME,
	PROBE_BACKOFF_MS,
	SAFE_POOL_SQLITE_VERSION,
} from './runtime.constants'

import { createDialecteError } from '@/errors'

import type { EngineLockMode } from '../served/engine.types'
import type {
	HeldEngineLock,
	PoolContents,
	PoolFileHead,
	PoolInstallOptions,
	SyncAccessFileHandle,
} from './runtime.types'
import type { SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * The project's pool, opened for this engine within `budgetMs`: first the loaded sqlite-wasm checked to
 * keep a pool whose install fails (`refuseUnsafeSqlite`), then the origin's private files checked,
 * the engine lock taken, then - inside one try that releases the lock on any failure - every file of
 * an existing pool probed (opened and closed again; one another engine still holds is waited for, then
 * refused PROJECT_ENGINE_BUSY) and refused PROJECT_DATABASE_LOST when it holds data but no database
 * (`refuseLostDatabase`), then, for a pool that never held pages (none yet, or blank files), the space
 * a new pool needs checked, and only then the pool
 * installed - one whose install fails anyway keeps its files (`preserveOnInitFailure`: by default
 * sqlite-wasm removes the whole pool directory on a failed install), and a later open in this worker
 * installs it again (`forceReinitIfPreviouslyFailed`: by default the failure is kept and answered again).
 */
export async function openPool(params: {
	sqlite3: Sqlite3Static
	dialecteId: string
	project: string
	lock: EngineLockMode
	budgetMs: number
	/** The creation id a view coming back knows: a pool holding no database then means the project was destroyed. */
	expectedCreationId?: string
}): Promise<{ pool: SAHPoolUtil; lock: HeldEngineLock }> {
	const { sqlite3, dialecteId, project, lock: mode, budgetMs, expectedCreationId } = params
	refuseUnsafeSqlite({ sqlite3, project })
	// a name no directory can be named after is refused before the lock is asked: a refusal holds nothing
	const directory = poolDirectoryOf({ dialecteId, project })
	const deadline = performance.now() + budgetMs
	const root = await privateRoot({ project })
	const lock = await takeEngineLock({ dialecteId, project, mode, deadline })
	try {
		const files = await poolFilesOf({ root, dialecteId, project })
		const heads = files.length === 0 ? [] : await probePoolFiles({ project, files, deadline })
		// a pool that never held pages (none, or blank files an install that ended left) is made as a new one -
		// unless a view coming back expects its project there: destroyed meanwhile, nothing made in its place
		if (refuseLostDatabase({ project, heads }) === 'blank') {
			refuseOtherCreation({ project, expectedCreationId, creationId: undefined })
			await refuseShortSpace({ project, bytes: NEW_POOL_FREE_BYTES })
		}
		const options: PoolInstallOptions = {
			name: POOL_VFS_NAME,
			directory,
			initialCapacity: POOL_CAPACITY,
			preserveOnInitFailure: true,
			forceReinitIfPreviouslyFailed: true,
		}
		const pool = await sqlite3.installOpfsSAHPoolVfs(options)
		return { pool, lock }
	} catch (thrown) {
		await lock.release()
		throw thrown
	}
}

/**
 * `ASSERTION_FAILED` when the loaded sqlite-wasm is older than 3.54.1: it ignores `preserveOnInitFailure`
 * and removes the project's whole pool - every file - when an install fails. Checked before the lock or any
 * file is touched. The JS glue's version is read: the pool is its code, the wasm is served on its own.
 */
function refuseUnsafeSqlite(params: { sqlite3: Sqlite3Static; project: string }): void {
	const { sqlite3, project } = params
	const { libVersion, libVersionNumber } = sqlite3.version
	if (libVersionNumber >= SAFE_POOL_SQLITE_VERSION) return
	throw createDialecteError('ASSERTION_FAILED', {
		detail: `Project "${project}" is not opened: sqlite-wasm ${libVersion} removes a project's files when their install fails; ${versionLabel({ number: SAFE_POOL_SQLITE_VERSION })} or later is needed (install the version @dialecte/core depends on)`,
		meta: { project, sqliteVersion: libVersion },
	})
}

/**
 * The pool this worker paused (a close), checked again before it is taken back, the engine lock held:
 * its files probed and the open refused `PROJECT_DATABASE_LOST` when they hold data but no database
 * any more - sqlite-wasm reads the headers again as it unpauses and would drop a damaged one.
 */
export async function probePausedPool(params: {
	dialecteId: string
	project: string
	/** The open's own deadline, set before it waited for the lock: one budget covers both. */
	deadline: number
	/** The creation id a view coming back knows: a pool holding no database then means the project was destroyed. */
	expectedCreationId?: string
}): Promise<void> {
	const { dialecteId, project, deadline, expectedCreationId } = params
	const root = await privateRoot({ project })
	const files = await poolFilesOf({ root, dialecteId, project })
	const heads = await probePoolFiles({ project, files, deadline })
	if (refuseLostDatabase({ project, heads }) === 'blank') {
		refuseOtherCreation({ project, expectedCreationId, creationId: undefined })
	}
}

/**
 * The project's pool gone with its directory, the engine lock held meanwhile: removed by sqlite-wasm
 * when this engine has it installed (`removeVfs`), else straight from the directory; then checked
 * gone, `PROJECT_DESTROY_FAILED` if not (a file another worker holds stays).
 */
export async function destroyPool(params: {
	dialecteId: string
	project: string
	pool: SAHPoolUtil | undefined
	/** Until when a file still held (a worker that just ended lets its handles go a little later) is waited for. */
	deadline: number
}): Promise<void> {
	const { dialecteId, project, pool, deadline } = params
	const root = await privateRoot({ project })
	if (pool) await pool.removeVfs()
	// what the pool's own removal left (a file held a moment), or the whole directory when no pool is open
	await removeDirectoryWithin({ root, dialecteId, project, deadline })
	if (await hasPoolDirectory({ root, dialecteId, project })) {
		throw createDialecteError('PROJECT_DESTROY_FAILED', {
			detail: `The files of project "${project}" are still there: another tab or worker may hold one`,
			meta: { project },
		})
	}
}

/**
 * The project's pool directory under the origin's private file system: one directory per dialecte, one per
 * project in it (`projectKeyOf`). A name or a dialecte id no directory can be named after - empty, `.`, `..` -
 * is refused `PROJECT_NAME_INVALID`, before any file is touched (every store refuses it as it is built: a guard).
 */
export function poolDirectoryOf(params: { dialecteId: string; project: string }): string {
	refuseUnnamableProject(params)
	return `${POOL_ROOT_DIRECTORY}/${projectKeyOf(params)}`
}

/**
 * The project's engine lock, held until released: free at once or refused `PROJECT_OPEN_ELSEWHERE`
 * (`if-available`), or waited for until `deadline` - what the work before the lock spent is not given again;
 * a deadline passed takes only a lock free at once - else `PROJECT_ENGINE_BUSY` (`wait`).
 */
export function takeEngineLock(params: {
	dialecteId: string
	project: string
	mode: EngineLockMode
	/** `performance.now()` time the wait ends (`wait` only). */
	deadline: number
}): Promise<HeldEngineLock> {
	const { dialecteId, project, mode, deadline } = params
	const budgetMs = Math.max(0, Math.round(deadline - performance.now()))
	const name = engineLockNameOf({ dialecteId, project })
	return new Promise(function requestLock(resolve, reject) {
		let letGo: () => void = releaseNothing
		const held = new Promise<void>(function holdUntilReleased(done) {
			letGo = done
		})
		// the request settles once the browser has let the lock go (or refused it): the release waits for that, so what
		// is answered after it reaches another context with the lock free
		async function release(): Promise<void> {
			letGo()
			await requested
		}
		const ifFree = mode === 'if-available' || budgetMs === 0
		const options: LockOptions = ifFree
			? { ifAvailable: true }
			: { signal: AbortSignal.timeout(budgetMs) }
		const requested: Promise<void> = navigator.locks
			.request(name, options, async function holdLock(granted) {
				if (!granted) {
					reject(
						mode === 'if-available'
							? createDialecteError('PROJECT_OPEN_ELSEWHERE', {
									detail: `Project "${project}" is open in another tab or window`,
									meta: { project },
								})
							: engineBusy({ project, budgetMs }),
					)
					return
				}
				resolve({ release })
				await held
			})
			.catch(function refuseNotGranted(thrown: unknown) {
				reject(engineBusy({ project, budgetMs, cause: thrown }))
			})
	})
}

/** The lock still held by another engine once the wait's budget is spent. */
function engineBusy(params: { project: string; budgetMs: number; cause?: unknown }): Error {
	const { project, budgetMs, cause } = params
	return createDialecteError(SQLITE_ERRORS.PROJECT_ENGINE_BUSY, {
		detail: `Project "${project}" was still held by another engine after ${budgetMs} ms`,
		meta: { project, budgetMs },
		cause: cause instanceof Error ? cause : undefined,
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
	dialecteId: string
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
 * Every file of the pool opened, its size and header read, and closed again: a file another engine
 * still holds (its lock gone, its handles not yet) is tried again with backoff until the deadline, then
 * `PROJECT_ENGINE_BUSY` (`meta.retriedOn`); a file that cannot be opened for another reason refuses the
 * open (`STORE_CONNECTION_FAILED`), the pool untouched.
 */
async function probePoolFiles(params: {
	project: string
	files: FileSystemFileHandle[]
	deadline: number
}): Promise<PoolFileHead[]> {
	const { project, files, deadline } = params
	const retriedOn = new Set<string>()
	const heads: PoolFileHead[] = []
	for (const file of files) {
		for (let attempt = 0; ; attempt += 1) {
			try {
				const handle = await (file as SyncAccessFileHandle).createSyncAccessHandle()
				try {
					const header = new Uint8Array(POOL_FILE_HEADER.headBytes)
					handle.read(header, { at: 0 })
					heads.push({ size: handle.getSize(), header })
				} finally {
					handle.close()
				}
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
					throw createDialecteError(SQLITE_ERRORS.PROJECT_ENGINE_BUSY, {
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
	return heads
}

/**
 * What the pool holds (`classifyPool`), or `PROJECT_DATABASE_LOST` when it holds data but no database: its database's
 * header was damaged, and sqlite-wasm would drop it with the pages behind it while SQLite made a new
 * empty database. Refused before the install: every file is kept as it is, the refusal holds on every
 * later open, and destroying the project removes them.
 */
function refuseLostDatabase(params: { project: string; heads: PoolFileHead[] }): PoolContents {
	const { project, heads } = params
	const contents = classifyPool({ files: heads })
	if (contents !== 'lost') return contents
	throw createDialecteError(SQLITE_ERRORS.PROJECT_DATABASE_LOST, {
		detail: `Project "${project}" holds data but its database is gone (its file's header is damaged): nothing was opened or changed`,
		meta: { project },
	})
}

/** A file another handle holds: what OPFS answers while a successor's predecessor still closes its handles. */
function isBusy(params: { thrown: unknown }): boolean {
	return (
		params.thrown instanceof DOMException && params.thrown.name === 'NoModificationAllowedError'
	)
}

/**
 * `STORE_QUOTA_EXCEEDED` when the origin has fewer than `bytes` left (a new pool's files, an import's
 * rows): refused before anything is written. A browser that tells no quota, or refuses to estimate it, is
 * trusted.
 */
export async function refuseShortSpace(params: { project: string; bytes: number }): Promise<void> {
	const { project, bytes } = params
	const estimate = await navigator.storage.estimate().catch(function noEstimate() {
		return undefined
	})
	const { quota, usage = 0 } = estimate ?? {}
	if (quota === undefined) return
	const available = quota - usage
	if (available >= bytes) return
	throw createDialecteError('STORE_QUOTA_EXCEEDED', {
		detail: `Project "${project}" needs ${bytes} bytes free, ${available} are left`,
		meta: { project, needed: bytes, available },
	})
}

/**
 * A write SQLite reports as an I/O error, explained by the file system: the origin has (nearly) no
 * storage left → `STORE_QUOTA_EXCEEDED`; anything else is no shortage (none returned). The pool keeps
 * the file system's own error (`QuotaExceededError`) to itself - SQLite sees an I/O error only - so the
 * shortage is inferred from the estimate: an I/O error of another cause on a nearly full origin is
 * answered as a shortage too.
 */
export async function explainOutOfSpace(params: {
	project: string
	thrown: unknown
}): Promise<Error | undefined> {
	const { project, thrown } = params
	const estimate = await navigator.storage.estimate().catch(function noEstimate() {
		return undefined
	})
	// no estimate: nothing explains the failure, it keeps its own key
	const { quota, usage = 0 } = estimate ?? {}
	if (quota === undefined) return undefined
	const available = quota - usage
	if (available >= OUT_OF_SPACE_BYTES) return undefined
	return createDialecteError('STORE_QUOTA_EXCEEDED', {
		detail: `Project "${project}" ran out of storage: ${available} bytes are left`,
		meta: { project, available },
		cause: thrown instanceof Error ? thrown : undefined,
	})
}

/**
 * The project's directory removed; a file still held is waited for with the probe's backoff until the
 * deadline. Absent already, or failing otherwise: the check after says what is left.
 */
async function removeDirectoryWithin(params: {
	root: FileSystemDirectoryHandle
	dialecteId: string
	project: string
	deadline: number
}): Promise<void> {
	const { root, dialecteId, project, deadline } = params
	const path = poolDirectoryOf({ dialecteId, project }).split('/')
	const entry = path.pop()!
	for (let attempt = 0; ; attempt += 1) {
		const parent = await existingDirectory({ root, path })
		try {
			await parent?.removeEntry(entry, { recursive: true })
			return
		} catch (thrown) {
			if (!isBusy({ thrown })) return
			const wait = PROBE_BACKOFF_MS[Math.min(attempt, PROBE_BACKOFF_MS.length - 1)]!
			if (performance.now() + wait > deadline) return
			await new Promise(function waitBeforeRetry(resolve) {
				setTimeout(resolve, wait)
			})
		}
	}
}

async function hasPoolDirectory(params: {
	root: FileSystemDirectoryHandle
	dialecteId: string
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

/** A SQLite version number (`3054001`) as SQLite writes it (`3.54.1`). */
function versionLabel(params: { number: number }): string {
	const { number } = params
	return `${Math.floor(number / 1_000_000)}.${Math.floor(number / 1_000) % 1_000}.${number % 1_000}`
}

function releaseNothing(): void {}
