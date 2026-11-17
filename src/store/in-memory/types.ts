import type { DistributiveOmit } from '../store.types'
import type { ChangeLogEntry, StoreNotice } from '../store.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentRecord, ProjectChannelMessage } from '@/project/types'
import type { AnyRawRecord, BlobRecord } from '@/types'

export type InMemoryStoreOptions = {
	/**
	 * When false, the store is a placeholder: mutations throw STORE_NOT_WRITABLE, reads answer empty,
	 * and it never reads, keeps or removes the state of its project. Default: true
	 */
	writable?: boolean
	/**
	 * The dialecte the store imports and exports files with; without it, `importFile` throws `IMPORT_FAILED`
	 * and `exportFile` `ASSERTION_FAILED`
	 */
	runtime?: StoreRuntime
	/**
	 * The dialecte of the project: with the name, which state the store reads and writes - two dialectes' projects
	 * of one name are two projects, as on every store that keeps them. Without it, the name alone.
	 */
	dialecteId?: string
}

/** What the in-memory stores of one project hold, the same for each instance of that project in a realm. */
export type InMemoryState = {
	documents: Map<string, DocumentRecord>
	/** The records of each document, by record table name, with the ids of each of its tags. */
	records: Map<string, RecordTable>
	changelog: Map<string, ChangeLogEntry[]>
	/** The sequence number of each document's last applied changelog entry. */
	heads: Map<string, number>
	/** The ids of the commits each document's undone entries carried when a later commit discarded them. */
	discardedCommits: Map<string, Set<string>>
	blobs: Map<string, BlobRecord>
	blobData: Map<string, Map<string, Blob>>
	/** The `writeId`s of the imports running on a store of this project: an `open` keeps their documents. */
	runningImports: Set<string>
	/** How many writes each document has taken (bulk writes, commits, undos, redos): what an export checks. */
	versions: Map<string, number>
}

/** A state as read: what a project with no state reads as, and all a placeholder store reads. */
export type ReadonlyInMemoryState = {
	documents: ReadonlyMap<string, DocumentRecord>
	records: ReadonlyMap<string, ReadonlyRecordTable>
	changelog: ReadonlyMap<string, readonly ChangeLogEntry[]>
	heads: ReadonlyMap<string, number>
	discardedCommits: ReadonlyMap<string, ReadonlySet<string>>
	blobs: ReadonlyMap<string, BlobRecord>
	blobData: ReadonlyMap<string, ReadonlyMap<string, Blob>>
	runningImports: ReadonlySet<string>
	versions: ReadonlyMap<string, number>
}

/** A connection of an in-memory project listening to its changes: the store it is, and its listener. */
export type InMemoryListener = { connection: object; listener: (notice: StoreNotice) => void }

/** A project event as an in-memory store announces it, its timestamp added when told. */
export type InMemoryChange = DistributiveOmit<ProjectChannelMessage, 'timestamp'>

/**
 * The records of one document by id, and the ids of each tag it holds: every write goes through `put` and `drop`,
 * so the tag index never misses one. A tag's ids are sorted once, then kept until that tag's next write.
 */
export type RecordTable = ReadonlyRecordTable & {
	/** Hold the record, under its tag (out of the tag it had, when another one) */
	put: (record: AnyRawRecord) => void
	/** Forget the record of the id, out of its tag; an id not held changes nothing */
	drop: (id: string) => void
}

/** The reads of a document's records: what a placeholder store, and a document not in the store, read. */
export type ReadonlyRecordTable = {
	get: (id: string) => AnyRawRecord | undefined
	has: (id: string) => boolean
	/** How many records it holds */
	size: () => number
	/** Every record held, in no order */
	records: () => Iterable<AnyRawRecord>
	/** The ids of the tag's records, in id order (UTF-16 code units, as every list read answers) */
	idsOfTag: (tagName: string) => readonly string[]
}

/** The ids of one tag of a document, and those ids in id order once a read asked for them, until the tag's next write. */
export type TagIds = { ids: Set<string>; sorted: readonly string[] | undefined }
