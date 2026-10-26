import type { ChangeLogEntry } from '../store.types'
import type { ImportRuntime } from '@/project/io/run-import.types'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, BlobRecord } from '@/types'

export type InMemoryStoreOptions = {
	/**
	 * When false, the store is a placeholder: mutations throw STORE_NOT_WRITABLE, reads answer empty,
	 * and it never reads, keeps or removes the state of its name. Default: true
	 */
	writable?: boolean
	/** The dialecte the store imports files with; without it, `importFile` throws `IMPORT_FAILED` */
	importRuntime?: ImportRuntime
}

/** What the in-memory stores of one name hold, the same for each instance of that name in a realm. */
export type InMemoryState = {
	documents: Map<string, DocumentRecord>
	/** The records of each document, by record table name. */
	records: Map<string, Map<string, AnyRawRecord>>
	changelog: Map<string, ChangeLogEntry[]>
	/** The sequence number of each document's last applied changelog entry. */
	heads: Map<string, number>
	blobs: Map<string, BlobRecord>
	blobData: Map<string, Map<string, Blob>>
	/** The `writeId`s of the imports running on a store of this name: an `open` keeps their documents. */
	runningImports: Set<string>
}

/** A state as read: what a name with no state reads as, and all a placeholder store reads. */
export type ReadonlyInMemoryState = {
	documents: ReadonlyMap<string, DocumentRecord>
	records: ReadonlyMap<string, ReadonlyMap<string, AnyRawRecord>>
	changelog: ReadonlyMap<string, readonly ChangeLogEntry[]>
	heads: ReadonlyMap<string, number>
	blobs: ReadonlyMap<string, BlobRecord>
	blobData: ReadonlyMap<string, ReadonlyMap<string, Blob>>
	runningImports: ReadonlySet<string>
}
