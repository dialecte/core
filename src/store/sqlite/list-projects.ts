import { projectKeyOf } from '../project-key'
import { LAYOUT_VERSION } from './engine/engine.constants'
import {
	LISTING_READ_ATTEMPTS,
	LISTING_READ_RETRY_MS,
	SQLITE_FILE_HEADER,
} from './list-projects.constants'
import { classifyPool, namesDatabase } from './runtime/pool-header'
import {
	OPAQUE_DIRECTORY,
	POOL_FILE_HEADER,
	POOL_ROOT_DIRECTORY,
} from './runtime/runtime.constants'

import { throwDialecteError } from '@/errors'

import type {
	ListedPoolFile,
	PoolEntry,
	ProjectListing,
	ProjectListingState,
} from './list-projects.types'

/**
 * The projects on SQLite storage of this origin - every dialecte's, or `dialecteId`'s - read from the origin's
 * private file system alone (no engine started, no wasm loaded; a project whose engine runs is read too), sorted by
 * dialecte and name: each one's state (`current`, `outdated`, `lost`, `new`, `unknown`), the bytes it takes and when
 * it was last written. Where the browser gives no private file system (Node, a private window) it refuses
 * `STORE_UNAVAILABLE`.
 *
 * @intent list the projects stored in the browser on SQLite storage, find outdated or lost projects on SQLite storage, show how much space each project takes, check whether a project exists on SQLite storage without opening it
 */
export async function listProjects(
	params: { dialecteId?: string } = {},
): Promise<ProjectListing[]> {
	const root = await privateFileSystem()
	return listProjectsIn({ root, dialecteId: params.dialecteId })
}

/**
 * The projects of the pool directory under `root`, as `listProjects` lists them. A directory removed while the walk
 * reads it (a project destroyed in another tab) is passed by; a pool whose files the browser refuses is `unknown`.
 */
export async function listProjectsIn(params: {
	root: FileSystemDirectoryHandle
	dialecteId?: string
}): Promise<ProjectListing[]> {
	const { root, dialecteId } = params
	const pools = await childDirectory({ parent: root, name: POOL_ROOT_DIRECTORY })
	if (!pools) return []
	const listed: ProjectListing[] = []
	for (const dialecteDirectory of (await entriesOf({ directory: pools })) ?? []) {
		if (dialecteDirectory.kind !== 'directory') continue
		const dialecte = decodedPart({ part: dialecteDirectory.name })
		if (dialecte === undefined) continue
		if (dialecteId !== undefined && dialecte !== dialecteId) continue
		for (const projectDirectory of (await entriesOf({ directory: dialecteDirectory })) ?? []) {
			if (projectDirectory.kind !== 'directory') continue
			const name = decodedPart({ part: projectDirectory.name })
			// a directory no project of ours is named so (its name not one `projectKeyOf` makes)
			if (name === undefined) continue
			if (
				projectKeyOf({ dialecteId: dialecte, project: name }) !==
				keyOf({ dialecteDirectory, projectDirectory })
			)
				continue
			const pool = await listPool({ name, dialecteId: dialecte, directory: projectDirectory })
			if (pool) listed.push(pool)
		}
	}
	return listed.sort(byDialecteThenName)
}

/**
 * A project's pool listed: its files (in sqlite-wasm's `.opaque` directory of the pool) read, each retried while the
 * browser refuses it, then classified; none when the pool was removed meanwhile.
 */
async function listPool(params: {
	name: string
	dialecteId: string
	directory: FileSystemDirectoryHandle
}): Promise<ProjectListing | undefined> {
	const { name, dialecteId } = params
	let entries: PoolEntry[] | undefined
	try {
		// the pool's own entries first: gone (destroyed meanwhile) is told apart from no files made yet
		const pool = await entriesOf({ directory: params.directory })
		if (pool === undefined) return undefined
		const opaque = pool.find(function isOpaque(entry) {
			return entry.kind === 'directory' && entry.name === OPAQUE_DIRECTORY
		}) as FileSystemDirectoryHandle | undefined
		entries = opaque ? await entriesOf({ directory: opaque }) : []
	} catch {
		// the browser refuses the pool's files now: listed, its state unknown
		return { name, dialecteId, state: 'unknown', bytes: 0, lastModified: 0 }
	}
	// removed while listed: a project destroyed meanwhile is no longer one
	if (entries === undefined) return undefined
	const files: ListedPoolFile[] = []
	let unreadable = false
	for (const entry of entries) {
		if (entry.kind !== 'file') continue
		const read = await readPoolFile({ handle: entry })
		if (read) files.push(read)
		else unreadable = true
	}
	const bytes = files.reduce(function sumSizes(total, file) {
		return total + file.size
	}, 0)
	const lastModified = files.reduce(function latest(time, file) {
		return Math.max(time, file.lastModified)
	}, 0)
	const state: ProjectListingState = unreadable ? 'unknown' : stateOf({ files })
	return { name, dialecteId, state, bytes, lastModified }
}

/**
 * Every entry of `directory`, read whole before any is looked at; none when the directory was removed meanwhile
 * (`NotFoundError`). Any other refusal is thrown.
 */
async function entriesOf(params: {
	directory: FileSystemDirectoryHandle
}): Promise<PoolEntry[] | undefined> {
	const entries: PoolEntry[] = []
	try {
		for await (const entry of params.directory.values()) entries.push(entry as PoolEntry)
	} catch (thrown) {
		if (isNotFound({ thrown })) return undefined
		throw thrown
	}
	return entries
}

/** What a pool's files say: the database's layout version against this one's, or no database. */
function stateOf(params: { files: ListedPoolFile[] }): ProjectListingState {
	const { files } = params
	const contents = classifyPool({ files })
	if (contents === 'blank') return 'new'
	if (contents === 'lost') return 'lost'
	// sqlite-wasm keeps the last file naming a path, should two (a damaged pool)
	const database = files.findLast(namesDatabase)!
	const version = layoutVersionOf({ data: database.data })
	if (version === undefined) return 'new'
	return version === LAYOUT_VERSION ? 'current' : 'outdated'
}

/** The layout version a database file's header keeps; none when the file holds no database yet. */
function layoutVersionOf(params: { data: Uint8Array }): number | undefined {
	const { data } = params
	if (data.byteLength < SQLITE_FILE_HEADER.bytes) return undefined
	const magic = new TextDecoder().decode(data.subarray(0, SQLITE_FILE_HEADER.magic.length))
	if (magic !== SQLITE_FILE_HEADER.magic) return undefined
	return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
		SQLITE_FILE_HEADER.userVersionOffset,
	)
}

/** A pool file read: its size, its time, its pool header and the start of its data; none when the browser refuses it. */
async function readPoolFile(params: {
	handle: FileSystemFileHandle
}): Promise<ListedPoolFile | undefined> {
	for (let attempt = 1; attempt <= LISTING_READ_ATTEMPTS; attempt++) {
		try {
			const file = await params.handle.getFile()
			const head = await file
				.slice(0, POOL_FILE_HEADER.bytes + SQLITE_FILE_HEADER.bytes)
				.arrayBuffer()
			const bytes = new Uint8Array(head)
			return {
				size: file.size,
				lastModified: file.lastModified,
				header: bytes.subarray(0, POOL_FILE_HEADER.headBytes),
				data: bytes.subarray(POOL_FILE_HEADER.bytes),
			}
		} catch {
			// written by its engine at this moment: read again shortly
			if (attempt === LISTING_READ_ATTEMPTS) break
			await new Promise(function waitBeforeRetry(resolve) {
				setTimeout(resolve, LISTING_READ_RETRY_MS)
			})
		}
	}
	return undefined
}

/** The origin's private file system; `STORE_UNAVAILABLE` where the browser gives none. */
async function privateFileSystem(): Promise<FileSystemDirectoryHandle> {
	const storage = globalThis.navigator?.storage
	try {
		if (typeof storage?.getDirectory === 'function') return await storage.getDirectory()
	} catch {
		// a private window refuses it: no storage, as where there is none
	}
	throwDialecteError('STORE_UNAVAILABLE', {
		detail:
			'The projects on SQLite storage cannot be listed here: this browser gives no private file system',
	})
}

/** The directory `name` under `parent`, none when it does not exist. */
async function childDirectory(params: {
	parent: FileSystemDirectoryHandle
	name: string
}): Promise<FileSystemDirectoryHandle | undefined> {
	try {
		return await params.parent.getDirectoryHandle(params.name)
	} catch (thrown) {
		if (isNotFound({ thrown })) return undefined
		throw thrown
	}
}

/** What the browser answers for a file or directory that is not there (any more). */
function isNotFound(params: { thrown: unknown }): boolean {
	return params.thrown instanceof DOMException && params.thrown.name === 'NotFoundError'
}

/** A part of a project's key decoded; none when it is not one `projectKeyOf` writes. */
function decodedPart(params: { part: string }): string | undefined {
	try {
		return decodeURIComponent(params.part)
	} catch {
		return undefined
	}
}

/** The key the two directories make, as they are named. */
function keyOf(params: {
	dialecteDirectory: FileSystemHandle
	projectDirectory: FileSystemHandle
}): string {
	return `${params.dialecteDirectory.name}/${params.projectDirectory.name}`
}

function byDialecteThenName(first: ProjectListing, second: ProjectListing): number {
	return (
		compareText({ first: first.dialecteId, second: second.dialecteId }) ||
		compareText({ first: first.name, second: second.name })
	)
}

/** Two texts by their code units: the same order in every locale. */
function compareText(params: { first: string; second: string }): number {
	const { first, second } = params
	return first < second ? -1 : first > second ? 1 : 0
}
