import type { AnyRawRecord } from '@/types'

/**
 * Store — the database port.
 *
 * Abstracts persistence so Document/Transaction don't couple to IndexedDB.
 * Implement DexieStore for production, InMemoryStore for tests.
 *
 * Not generic on Config — stores raw records as-is.
 * Type narrowing lives in Document/Transaction, not here.
 */
export interface Store {
	/** Unique identifier for this store — used to scope the BroadcastChannel */
	name: string

	/** Get a single record by primary key */
	get(id: string): Promise<AnyRawRecord | undefined>

	/** Get all records with a given tagName */
	getByTagName(tagName: string): Promise<AnyRawRecord[]>

	/** Atomic commit — all-or-nothing write */
	commit(params: {
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void>

	/** Wipe all records */
	clear(): Promise<void>

	/** Open the connection (if not already open) */
	open(): Promise<void>

	/** Close the connection */
	close(): void

	/** Delete the database entirely (not just clear — remove from browser) */
	destroy(): Promise<void>

	/** Undo the last committed change. No-op when at the beginning of history. */
	undo(): Promise<void>

	/** Redo the next change. No-op when at the end of history. */
	redo(): Promise<void>

	/** Return all changelog entries in ascending sequenceNumber order */
	getChangeLog(): Promise<ChangeLogEntry[]>
}

export type ChangeLogEntry = {
	id: string
	sequenceNumber: number
	timestamp: number
	operations: {
		creates: AnyRawRecord[]
		updates: { before: AnyRawRecord; after: AnyRawRecord }[]
		deletes: AnyRawRecord[]
	}
}

/** Single-row metadata record stored in the _meta table */
export type ChangeLogMeta = {
	key: 'head'
	value: number
}

export type StorageOptions =
	| { type: 'local'; databaseName: string }
	| { type: 'custom'; store: Store }
