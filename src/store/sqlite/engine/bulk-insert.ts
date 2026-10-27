import { RECORD_COLUMN_LIST, ROW_SELECT_EXPRESSIONS, ROWS_PER_BIND } from './engine.constants'

import { checkJsonValues } from '@/store/json-values'

import type { EncodedRows, LeadColumns, RecordSinkParams } from './engine.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * Records a caller hands a write (its creates, a commit's updates) encoded: a value that is not JSON
 * refuses the whole write with `STORE_VALUE_NOT_JSON` (whole records, as every store checks them).
 */
export function encodeCheckedRecords(params: { records: AnyRawRecord[] }): EncodedRows {
	checkJsonValues({ value: params.records })
	return encodeRecords({ records: params.records })
}

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

/**
 * The encoded rows into a table of record rows: one JSON1 `INSERT ... SELECT` per batch. `lead` gives
 * columns of the same value on every row, written before the record's (a history row's entry and
 * part); such rows are written in the order given.
 */
export function insertEncodedRows(params: {
	db: Database
	table: string
	rows: EncodedRows
	lead?: LeadColumns
}): void {
	const { db, table, rows, lead } = params
	if (rows.payloads.length === 0) return
	const statement = db.prepare(
		lead
			? `INSERT INTO ${table} (${[...lead.columns, RECORD_COLUMN_LIST].join(', ')}) ` +
					`SELECT ${[...lead.columns.map(() => '?'), ...ROW_SELECT_EXPRESSIONS].join(', ')} FROM json_each(?) e ORDER BY e.key`
			: `INSERT INTO ${table} (${RECORD_COLUMN_LIST}) SELECT ${ROW_SELECT_EXPRESSIONS.join(', ')} FROM json_each(?) e`,
	)
	try {
		for (const payload of rows.payloads)
			statement.bind([...(lead?.values ?? []), payload]).stepReset()
	} finally {
		statement.finalize()
	}
}

/**
 * The row sink: one bind of records into a document table, in the caller's transaction - encoded
 * (timed as `import::encode`), inserted. The caller has checked them (values, ids) first.
 */
export function insertRecords(params: RecordSinkParams): void {
	const { db, table, records, perf } = params
	const rows = perf.time('import::encode', function encode() {
		return encodeRecords({ records })
	})
	insertEncodedRows({ db, table, rows })
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
