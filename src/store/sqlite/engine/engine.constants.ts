import type { SqliteEngineOptions } from './engine.types'

/** The layout of the project file this engine reads and writes, kept in the file's header (`user_version`). */
export const LAYOUT_VERSION = 1

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

/** Records per JSON1 bind of an insert or an update: bounds one statement's JSON payload. */
export const ROWS_PER_BIND = 1000

/** The record columns that hold JSON (kept as JSON text by an insert or an update). */
export const RECORD_JSON_COLUMNS: readonly string[] = ['attributes', 'children']

export const RECORD_COLUMN_LIST = Object.keys(RECORD_COLUMNS).join(', ')

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
