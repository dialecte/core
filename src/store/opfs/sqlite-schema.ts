import type { RecordSchema } from '../store.types'

/**
 * SQLite DDL for record tables and index derivation from a backend-agnostic
 * `RecordSchema`.
 *
 * Records are stored one row per record with denormalized scalar columns for the
 * indexed fields (`tagName`, `parentId`, `parentTagName`), split `namespace`
 * columns (`nsPrefix`, `nsUri`), and a JSON-text `attributes` column. `children`
 * is NOT stored: it is the inverse of `parentId`, so it is derived on read via
 * `WHERE parentId=?`. Dropping it removes a per-row `JSON.stringify` and the row's
 * fattest column. multiEntry array indexes (`children.*`) are likewise dropped.
 */

/** Ordered record-table columns (the write/read binding order). */
export const RECORD_COLUMNS = [
	'id',
	'tagName',
	'nsPrefix',
	'nsUri',
	'value',
	'parentId',
	'parentTagName',
	'attributes',
] as const

// RecordSchema index paths → record-table columns. Paths not present here
// (notably the `children.*` array indexes) are dropped.
const PATH_TO_COLUMN: Record<string, string> = {
	tagName: 'tagName',
	'parent.id': 'parentId',
	'parent.tagName': 'parentTagName',
	id: 'id',
}

export function recordTableDDL(tableName: string): string {
	return (
		`CREATE TABLE IF NOT EXISTS "${tableName}" (` +
		'id TEXT PRIMARY KEY, ' +
		'tagName TEXT, ' +
		'nsPrefix TEXT, ' +
		'nsUri TEXT, ' +
		'value TEXT, ' +
		'parentId TEXT, ' +
		'parentTagName TEXT, ' +
		'attributes TEXT' +
		')'
	)
}

export function recordIndexDDL(tableName: string, schema: RecordSchema): string[] {
	const stmts: string[] = []

	for (const path of schema.indexes) {
		const col = PATH_TO_COLUMN[path]
		if (!col || col === 'id') continue // unknown/array path dropped; id already the PK
		stmts.push(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_${col}" ON "${tableName}"("${col}")`)
	}

	for (const compound of schema.compoundIndexes) {
		const cols = compound.map((path) => PATH_TO_COLUMN[path])
		if (cols.some((c) => c === undefined)) continue // contains an unmapped (array) path → drop
		const colList = cols.map((c) => `"${c}"`).join(',')
		stmts.push(
			`CREATE INDEX IF NOT EXISTS "idx_${tableName}_${cols.join('_')}" ON "${tableName}"(${colList})`,
		)
	}

	// schema.arrayIndexes (children.*) intentionally omitted.
	return stmts
}
