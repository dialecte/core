import { RECORD_COLUMN_LIST, ROW_SELECT_EXPRESSIONS, ROWS_PER_BIND } from './engine.constants'

import type { EncodedRows } from './engine.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/** The records as rows, in batches of one bind each: records already checked as JSON. */
export function encodeRecords(params: { records: AnyRawRecord[] }): EncodedRows {
	const { records } = params
	const payloads: string[] = []
	for (let start = 0; start < records.length; start += ROWS_PER_BIND) {
		const rows = records.slice(start, start + ROWS_PER_BIND).map((record) => recordRow({ record }))
		payloads.push(JSON.stringify(rows))
	}
	return { payloads }
}

/** The encoded rows into the document table: one JSON1 `INSERT ... SELECT` per batch. */
export function insertEncodedRows(params: {
	db: Database
	table: string
	rows: EncodedRows
}): void {
	const { db, table, rows } = params
	if (rows.payloads.length === 0) return
	const statement = db.prepare(
		`INSERT INTO ${table} (${RECORD_COLUMN_LIST}) SELECT ${ROW_SELECT_EXPRESSIONS.join(', ')} FROM json_each(?) e`,
	)
	try {
		for (const payload of rows.payloads) statement.bind([payload]).stepReset()
	} finally {
		statement.finalize()
	}
}

/** A record as a row, in the order of `RECORD_COLUMNS`. */
function recordRow(params: { record: AnyRawRecord }): unknown[] {
	const { record } = params
	return [
		record.id,
		record.tagName,
		record.namespace.prefix,
		record.namespace.uri,
		record.value,
		record.parent?.id ?? null,
		record.parent?.tagName ?? null,
		record.attributes,
		record.children,
	]
}
