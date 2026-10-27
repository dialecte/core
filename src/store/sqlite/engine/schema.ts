import {
	DOCUMENT_COLUMNS,
	LAYOUT_VERSION,
	META_KEY,
	RECORD_COLUMNS,
	RECORD_INDEXES,
} from './engine.constants'
import { inWriteTransaction } from './transaction'

import { throwDialecteError } from '@/errors'
import { TABLE_DOCUMENTS, TABLE_META } from '@/store/store.constants'

import type { RecordIndex } from './engine.types'
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
 * table, the document registry and the layout version in the header, in one transaction.
 */
function createFile(params: { sqlite3: Sqlite3Static; db: Database; dialecteId: string }): void {
	const { sqlite3, db, dialecteId } = params
	db.exec('PRAGMA auto_vacuum=INCREMENTAL')
	inWriteTransaction({ sqlite3, db, work: writeLayout })

	function writeLayout(): void {
		db.exec(
			`CREATE TABLE ${TABLE_META} (key TEXT PRIMARY KEY, value TEXT NOT NULL);` +
				`CREATE TABLE ${TABLE_DOCUMENTS} (seq INTEGER PRIMARY KEY, ${columnDefinitions({ columns: DOCUMENT_COLUMNS })});`,
		)
		db.exec({
			sql: `INSERT INTO ${TABLE_META} (key, value) VALUES (?, ?), (?, ?)`,
			bind: [META_KEY.dialecteId, dialecteId, META_KEY.layoutVersion, String(LAYOUT_VERSION)],
		})
		db.exec(`PRAGMA user_version=${LAYOUT_VERSION}`)
	}
}

/**
 * Lay out a new file, or check the layout of one: the layout version is read from the header, which
 * every layout keeps, before anything else of the file. A file at another layout - or holding tables
 * with none - is refused with `PROJECT_LAYOUT_OUTDATED`, nothing of it written.
 */
export function prepareFile(params: {
	sqlite3: Sqlite3Static
	db: Database
	dialecteId: string
	steadyCacheMiB: number
}): void {
	const { sqlite3, db, dialecteId, steadyCacheMiB } = params
	// read before any pragma: a refused file is never written, nor locked by this connection
	const layoutVersion = Number(db.selectValue('PRAGMA user_version'))
	const tables = Number(db.selectValue('SELECT count(*) FROM sqlite_schema'))
	if (layoutVersion === LAYOUT_VERSION || (layoutVersion === 0 && tables === 0)) {
		applyConnectionPragmas({ db, steadyCacheMiB })
		if (layoutVersion === 0) createFile({ sqlite3, db, dialecteId })
		return
	}
	throwDialecteError('PROJECT_LAYOUT_OUTDATED', {
		detail:
			`The project file is at layout ${layoutVersion}, this library reads layout ${LAYOUT_VERSION}: ` +
			'delete the project and import its files again',
		meta: { layoutVersion, expectedLayoutVersion: LAYOUT_VERSION },
	})
}

/** A document's record table, without its indexes: a rowid table holding one row per record (its children listed on it). */
export function createRecordTable(params: { db: Database; table: string }): void {
	const { db, table } = params
	db.exec(`CREATE TABLE ${table} (${columnDefinitions({ columns: RECORD_COLUMNS })})`)
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

/**
 * Give the free pages back to the file (incremental auto-vacuum): after a document's table is
 * dropped, the file shrinks by its pages. One step frees one page: stepped to the end.
 */
export function reclaimFreePages(params: { db: Database }): void {
	const statement = params.db.prepare('PRAGMA incremental_vacuum')
	try {
		while (statement.step());
	} finally {
		statement.finalize()
	}
}
