import { RECORD_COLUMN_LIST, ROW_SELECT_EXPRESSIONS, ROWS_PER_BIND } from './engine.constants'

import type { EncodedRows } from './engine.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * The records as rows, in batches of one bind each. A value JSON would drop or change silently and
 * a structured clone refuses - a function, a symbol - is refused here, before anything is written.
 */
export function encodeRecords(params: { records: AnyRawRecord[] }): EncodedRows {
	const { records } = params
	const payloads: string[] = []
	for (let start = 0; start < records.length; start += ROWS_PER_BIND) {
		const rows = records.slice(start, start + ROWS_PER_BIND).map((record) => recordRow({ record }))
		payloads.push(encodeJson({ value: rows }))
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

/**
 * JSON text of a value. A function or a symbol is refused (a structured clone refuses them, JSON
 * would drop them silently). Any other value JSON does not keep as given is changed as JSON changes
 * it: a Date becomes its ISO string, a Map or a Set an empty object, NaN and Infinity null, an
 * `undefined` field is dropped; a BigInt throws.
 */
export function encodeJson(params: { value: unknown }): string {
	return JSON.stringify(params.value, refuseUncopyable)
}

function refuseUncopyable(_key: string, value: unknown): unknown {
	if (typeof value === 'function' || typeof value === 'symbol') {
		throw new TypeError(`A ${typeof value} cannot be stored`)
	}
	return value
}
