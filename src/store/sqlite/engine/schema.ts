import {
	APPLICATION_ID_DIGEST,
	BLOB_COLUMNS,
	BLOB_DATA_COLUMNS,
	CHANGELOG_COLUMNS,
	DOCUMENT_COLUMNS,
	LAYOUT_VERSION,
	META_KEY,
	RECORD_COLUMNS,
	RECORD_INDEXES,
	TABLE_BLOB_DATA,
} from './engine.constants'
import { inWriteTransaction } from './transaction'

import { throwDialecteError } from '@/errors'
import { refuseOtherCreation } from '@/store/engine/creation-refusal'
import { TABLE_BLOBS, TABLE_CHANGELOG, TABLE_DOCUMENTS, TABLE_META } from '@/store/store.constants'

import type { MetaRow, RecordIndex } from './engine.types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * What every connection of the engine runs with: it is the file's only user (exclusive lock),
 * every write durable (rollback journal, full sync), the steady page cache of `steadyCacheMiB`.
 */
function applyConnectionPragmas(params: { db: Database; steadyCacheMiB: number }): void {
	const { db, steadyCacheMiB } = params
	db.exec(
		'PRAGMA locking_mode=EXCLUSIVE; PRAGMA temp_store=MEMORY; ' +
			'PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=FULL; ' +
			`PRAGMA cache_size=${-steadyCacheMiB * 1024};`,
	)
}

/**
 * A new file: incremental auto-vacuum (it only takes on a file without tables), then the meta
 * table (its dialecte, its layout, a new creation id), the document registry, the history entries, the
 * blob registry and the blobs' bytes, and in the header the layout version and the dialecte's
 * `application_id`, in one transaction. Answers the creation id.
 */
function createFile(params: { sqlite3: Sqlite3Static; db: Database; dialecteId: string }): string {
	const { sqlite3, db, dialecteId } = params
	const creationId = crypto.randomUUID()
	db.exec('PRAGMA auto_vacuum=INCREMENTAL')
	inWriteTransaction({ sqlite3, db, work: writeLayout })
	return creationId

	function writeLayout(): void {
		db.exec(
			`CREATE TABLE ${TABLE_META} (key TEXT PRIMARY KEY, value TEXT NOT NULL);` +
				`CREATE TABLE ${TABLE_DOCUMENTS} (seq INTEGER PRIMARY KEY, ${columnDefinitions({ columns: DOCUMENT_COLUMNS })});` +
				`CREATE TABLE ${TABLE_CHANGELOG} (${columnDefinitions({ columns: CHANGELOG_COLUMNS })});` +
				`CREATE UNIQUE INDEX ${TABLE_CHANGELOG}_sequence ON ${TABLE_CHANGELOG}(documentId, sequenceNumber);` +
				`CREATE INDEX ${TABLE_CHANGELOG}_state ON ${TABLE_CHANGELOG}(documentId, state, sequenceNumber);` +
				`CREATE INDEX ${TABLE_CHANGELOG}_writeId ON ${TABLE_CHANGELOG}(writeId);` +
				`CREATE TABLE ${TABLE_BLOBS} (${columnDefinitions({ columns: BLOB_COLUMNS })});` +
				`CREATE INDEX ${TABLE_BLOBS}_documentId ON ${TABLE_BLOBS}(documentId);` +
				`CREATE TABLE ${TABLE_BLOB_DATA} (${columnDefinitions({ columns: BLOB_DATA_COLUMNS })});`,
		)
		db.exec({
			sql: `INSERT INTO ${TABLE_META} (key, value) VALUES (?, ?), (?, ?), (?, ?)`,
			bind: [
				META_KEY.dialecteId,
				dialecteId,
				META_KEY.layoutVersion,
				String(LAYOUT_VERSION),
				META_KEY.creationId,
				creationId,
			],
		})
		db.exec(`PRAGMA application_id=${dialecteApplicationId({ dialecteId })}`)
		db.exec(`PRAGMA user_version=${LAYOUT_VERSION}`)
	}
}

/**
 * The dialecte's mark in a project file's header (`PRAGMA application_id`, a signed 32-bit integer): the
 * FNV-1a digest of its id, read with the layout version without opening the file. A hint only - two ids may
 * share a digest; the file's directory and its `_meta` table say the dialecte.
 */
export function dialecteApplicationId(params: { dialecteId: string }): number {
	const { offsetBasis, prime } = APPLICATION_ID_DIGEST
	let digest: number = offsetBasis
	for (const byte of new TextEncoder().encode(params.dialecteId)) {
		digest = Math.imul(digest ^ byte, prime)
	}
	// SQLite keeps it signed
	return digest | 0
}

/**
 * Lay out a new file, or check one: the layout version is read from the header, which every layout keeps,
 * before anything else of the file. A file at another layout - or holding tables with none - is refused with
 * `PROJECT_LAYOUT_OUTDATED`, one of another dialecte with `PROJECT_DIALECTE_MISMATCH`: nothing of it written.
 * Answers the file's creation id.
 */
export function prepareFile(params: {
	sqlite3: Sqlite3Static
	db: Database
	/** The project's name, said in a refusal. */
	project: string
	dialecteId: string
	/** The creation id the opener knows (a view coming back): a new file or one of another id is refused. */
	expectedCreationId?: string
	steadyCacheMiB: number
}): { creationId: string } {
	const { sqlite3, db, project, dialecteId, expectedCreationId, steadyCacheMiB } = params
	// read before any pragma: a refused file is never written, nor locked by this connection
	const layoutVersion = Number(db.selectValue('PRAGMA user_version'))
	const tables = Number(db.selectValue('SELECT count(*) FROM sqlite_schema'))
	if (layoutVersion === 0 && tables === 0) {
		// a view coming back to a project finds none: destroyed meanwhile, never made again empty here
		refuseOtherCreation({ project, expectedCreationId, creationId: undefined })
		applyConnectionPragmas({ db, steadyCacheMiB })
		return { creationId: createFile({ sqlite3, db, dialecteId }) }
	}
	if (layoutVersion === LAYOUT_VERSION) {
		const meta = readMeta({ db })
		refuseOtherDialecte({ project, dialecteId, fileDialecteId: meta.dialecteId })
		refuseOtherCreation({ project, expectedCreationId, creationId: meta.creationId })
		applyConnectionPragmas({ db, steadyCacheMiB })
		return { creationId: meta.creationId }
	}
	throwDialecteError('PROJECT_LAYOUT_OUTDATED', {
		detail:
			`The project file is at layout ${layoutVersion}, this library reads layout ${LAYOUT_VERSION}: ` +
			'delete the project and import its files again',
		meta: { layoutVersion, expectedLayoutVersion: LAYOUT_VERSION },
	})
}

/** What a file of this layout says of itself in its `_meta` table. */
function readMeta(params: { db: Database }): { dialecteId: string; creationId: string } {
	const rows = params.db.selectObjects(`SELECT key, value FROM ${TABLE_META}`) as MetaRow[]
	const meta = new Map(rows.map(metaEntry))
	return {
		dialecteId: meta.get(META_KEY.dialecteId) ?? '',
		creationId: meta.get(META_KEY.creationId) ?? '',
	}
}

function metaEntry(row: MetaRow): [string, string] {
	return [row.key, row.value]
}

/** A file another dialecte stored, refused before anything of it is written. */
function refuseOtherDialecte(params: {
	project: string
	dialecteId: string
	fileDialecteId: string
}): void {
	const { project, dialecteId, fileDialecteId } = params
	if (fileDialecteId === dialecteId) return
	throwDialecteError('PROJECT_DIALECTE_MISMATCH', {
		detail: `The file of "${project}" was stored by ${fileDialecteId || 'no dialecte'}, this engine runs ${dialecteId}: nothing of it was written`,
		meta: { project, projectDialecteId: fileDialecteId, realmDialecteId: dialecteId },
	})
}

/** A document's record table, without its indexes: a rowid table holding one row per record (its children listed on it). */
export function createRecordTable(params: { db: Database; table: string }): void {
	const { db, table } = params
	db.exec(`CREATE TABLE ${table} (${columnDefinitions({ columns: RECORD_COLUMNS })})`)
}

/**
 * A document's history-rows table: one row per record of a part of an entry (`HISTORY_PART`), the
 * record whole in the record table's columns, numbered in the order written; read by entry and part.
 */
export function createHistoryRowsTable(params: { db: Database; table: string }): void {
	const { db, table } = params
	db.exec(
		`CREATE TABLE ${table} (rowNo INTEGER PRIMARY KEY, entry INTEGER NOT NULL, part INTEGER NOT NULL, ` +
			`${columnDefinitions({ columns: RECORD_COLUMNS })});` +
			`CREATE INDEX ${table}_entry ON ${table}(entry, part);`,
	)
}

/** One index of a record table, named after the table and the index. */
export function createRecordIndex(params: {
	db: Database
	table: string
	index: RecordIndex
}): void {
	const { db, table, index } = params
	const { column, unique } = RECORD_INDEXES[index]
	db.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${table}_${index} ON ${table}(${column})`)
}

/** Every index of a record table: the ones a registered document has from the start. */
export function createRecordIndexes(params: { db: Database; table: string }): void {
	for (const index of Object.keys(RECORD_INDEXES) as RecordIndex[]) {
		createRecordIndex({ ...params, index })
	}
}

/** Columns with their SQL types as the body of a `CREATE TABLE`, in the order given. */
export function columnDefinitions(params: { columns: Record<string, string> }): string {
	return Object.entries(params.columns)
		.map(([column, type]) => `${column} ${type}`)
		.join(', ')
}
