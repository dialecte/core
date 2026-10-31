/**
 * What a project on SQLite storage is to its app, from its files alone: `current` (opened by this version), `outdated`
 * (stored by another version of the library: destroy it, import its files again), `lost` (its files hold data but its
 * database is gone: destroy it), `new` (made, never written), `unknown` (its files could not be read now - its engine
 * writing: list again).
 */
export type ProjectListingState = 'current' | 'outdated' | 'lost' | 'new' | 'unknown'

/** A project on SQLite storage, as `listProjects` lists it. */
export type ProjectListing = {
	name: string
	/** The dialecte whose project it is: two dialectes' projects of one name are two projects. */
	dialecteId: string
	state: ProjectListingState
	/** The bytes its files take. */
	bytes: number
	/** When its files were last written (ms since the epoch). */
	lastModified: number
}

/** A pool file as listing reads it: its size, when written, its pool header, the start of its data. */
export type ListedPoolFile = {
	size: number
	lastModified: number
	header: Uint8Array
	data: Uint8Array
}

/** An entry of a directory listing reads: a directory or a file. */
export type PoolEntry = FileSystemDirectoryHandle | FileSystemFileHandle
