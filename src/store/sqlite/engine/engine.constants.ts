import type { SqliteEngineOptions } from './engine.types'

/** The layout of the project file this engine reads and writes, kept in the file's header (`user_version`). */
export const LAYOUT_VERSION = 3

export const DEFAULT_ENGINE_OPTIONS: SqliteEngineOptions = {
	/**
	 * Both page caches, the steady one and the import one, take `deviceMemoryGiB * 64` MiB, held
	 * between 64 and 512 MiB. A worker's wasm memory never shrinks, so after a large import (826 MiB
	 * measured at 500 MB) the memory is already taken; above 512 MiB nothing is gained, and this sqlite-wasm build
	 * caps its memory at 2 GiB. Known limit: deleting a tenth of a 500 MB document (about 430,000
	 * records) takes about 10 s on a device given 64 MiB (1 GiB of memory reported or less) and about
	 * 4.5 s at 512 MiB (8 GiB and more); an edit under 1 % of such a document stays under a second.
	 */
	cacheRule: { mibPerGiB: 64, floorMiB: 64, ceilingMiB: 512 },
	/**
	 * An import commits about once a second (a commit with synchronous off costs little), so calls of
	 * other connections run between two of its transactions within about a second.
	 */
	importWindowMs: 1000,
	/**
	 * Free pages are given back 256 at a time (1 MiB of 4 KiB pages), and the calls waiting run after
	 * every 50 ms of it: giving back a dead 450 MB import held the engine 6.6 s in one statement.
	 */
	reclaimSliceMs: 50,
	reclaimPagesPerStatement: 256,
}

/** The device's memory when the realm does not report it (Firefox, node): a 4 GiB device. */
export const DEFAULT_DEVICE_MEMORY_GIB = 4

/** The keys of the `_meta` table: what the file says of itself. */
export const META_KEY = {
	dialecteId: 'dialecteId',
	layoutVersion: 'layoutVersion',
} as const

/** A document's registry row: each column with its SQL type, in binding order (after its `seq`). */
export const DOCUMENT_COLUMNS = {
	id: 'TEXT NOT NULL UNIQUE',
	name: 'TEXT NOT NULL',
	extension: 'TEXT NOT NULL',
	configKey: 'TEXT NOT NULL',
	createdAt: 'INTEGER NOT NULL',
	metadata: 'TEXT',
	status: 'TEXT NOT NULL',
	writeId: 'TEXT',
	/** One document per path: SQLite lets any number of documents without one through. */
	path: 'TEXT UNIQUE',
} as const

/**
 * A history entry: one row per commit of a document, in a `HISTORY_ENTRY_STATE`. An id is never given
 * twice, a removed document's entries included.
 */
export const CHANGELOG_COLUMNS = {
	id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
	documentId: 'TEXT NOT NULL',
	/** Its place in the document's history; none once discarded. */
	sequenceNumber: 'INTEGER',
	timestamp: 'INTEGER NOT NULL',
	writeId: 'TEXT NOT NULL',
	state: 'INTEGER NOT NULL',
} as const

/**
 * Where a history entry stands: applied (the document's first entries, in sequence), undone (the
 * ones after, a redo applies the first of them again), or discarded (undone, then a commit came: no
 * place and no records any more, only its write id, so the commit's outcome stays known).
 */
export const HISTORY_ENTRY_STATE = {
	applied: 1,
	undone: 0,
	discarded: -1,
} as const

/** A blob's entry, by its id and its owner document; its bytes are kept apart. */
export const BLOB_COLUMNS = {
	id: 'TEXT PRIMARY KEY',
	documentId: 'TEXT NOT NULL',
	entry: 'TEXT NOT NULL',
} as const

/** A blob's bytes and their type. */
export const BLOB_DATA_COLUMNS = {
	id: 'TEXT PRIMARY KEY',
	type: 'TEXT NOT NULL',
	bytes: 'BLOB NOT NULL',
} as const

/** A record row: each column with its SQL type, in binding order; a record's children listed on it. */
export const RECORD_COLUMNS = {
	id: 'TEXT NOT NULL',
	tagName: 'TEXT NOT NULL',
	nsPrefix: 'TEXT',
	nsUri: 'TEXT',
	value: 'TEXT',
	parentId: 'TEXT',
	parentTagName: 'TEXT',
	attributes: 'TEXT',
	children: 'TEXT',
} as const

/**
 * The indexes of a record table, in the order an import builds them: the id (unique: a taken id is
 * refused) and the tag name - the read paths of the port. A registered document has them from the
 * start; an imported one gets them as its import goes (the id index at its first update or delete).
 */
export const RECORD_INDEXES = {
	id: { column: 'id', unique: true },
	tag: { column: 'tagName', unique: false },
} as const

/**
 * Each part of a history entry, as kept on its rows: the records a commit created, each updated one
 * before and after it, the records it deleted.
 */
export const HISTORY_PART = {
	create: 0,
	before: 1,
	after: 2,
	delete: 3,
} as const

/** Prefix of a document's history-rows table, numbered as its record table (`xch_<seq>`). */
export const TABLE_HISTORY_ROWS_PREFIX = 'xch_'

/** The bytes of every blob, by blob id; their entries are in the shared blob registry. */
export const TABLE_BLOB_DATA = '_blobData'

/** The repeated ids a refused index build names at most: enough to find them, bounded for a file of many. */
export const DUPLICATE_IDS_REPORTED = 100

/** Records per JSON1 bind of an insert or an update: bounds one statement's JSON payload. */
export const ROWS_PER_BIND = 1000

/** The record columns that hold JSON (kept as JSON text by an insert or an update). */
export const RECORD_JSON_COLUMNS: readonly string[] = ['attributes', 'children']

/** The record columns' names, in binding order. */
export const RECORD_COLUMN_NAMES = Object.keys(RECORD_COLUMNS)

export const RECORD_COLUMN_LIST = RECORD_COLUMN_NAMES.join(', ')

export const DOCUMENT_COLUMN_LIST = Object.keys(DOCUMENT_COLUMNS).join(', ')

/** A JSON1 row's columns as the select list of an insert: `e.value->>n`, JSON columns as `e.value->n`. */
export const ROW_SELECT_EXPRESSIONS = Object.keys(RECORD_COLUMNS).map((column, index) =>
	RECORD_JSON_COLUMNS.includes(column) ? `e.value->${index}` : `e.value->>${index}`,
)

/** `UPDATE ... FROM` a JSON1 batch: each column but the id set from the batch row of its id. */
export const RECORD_UPDATE_ASSIGNMENTS = Object.keys(RECORD_COLUMNS)
	.slice(1)
	.map((column, index) => `${column} = u.c${index + 1}`)
	.join(', ')

export const ROW_SELECT_ALIASES = ROW_SELECT_EXPRESSIONS.map(
	(expression, index) => `${expression} AS c${index}`,
).join(', ')

/** An import needs about this many times its file's size free (its rows, its indexes, the journal). */
export const IMPORT_SPACE_FACTOR = 2
