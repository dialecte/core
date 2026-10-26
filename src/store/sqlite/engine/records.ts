import { encodeRecords } from './bulk-insert'
import {
	RECORD_COLUMN_LIST,
	RECORD_UPDATE_ASSIGNMENTS,
	ROW_SELECT_ALIASES,
	ROWS_PER_BIND,
} from './engine.constants'

import { throwDialecteError } from '@/errors'
import { applyRecordPatch } from '@/store/apply-record-patch'
import { compareById } from '@/store/compare-by-id'
import { throwDuplicateRecordIds } from '@/store/store-errors'

import type { EncodedRows } from './engine.types'
import type { AnyRawRecord, AnyRelationship, RecordPatch } from '@/types'
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm'

export function readRecord(params: {
	db: Database
	table: string
	id: string
}): AnyRawRecord | undefined {
	const { db, table, id } = params
	const [row] = db.selectArrays(`SELECT ${RECORD_COLUMN_LIST} FROM ${table} WHERE id = ?`, [id])
	return row ? recordOf({ row }) : undefined
}

/**
 * Every record of the table, in id order: read in table order (a plain scan), sorted here - SQLite
 * compares by code point, the port by UTF-16 code unit.
 */
export function readAllRecords(params: { db: Database; table: string }): AnyRawRecord[] {
	const { db, table } = params
	return db
		.selectArrays(`SELECT ${RECORD_COLUMN_LIST} FROM ${table}`)
		.map((row) => recordOf({ row }))
		.sort(compareById)
}

export function readRecordsByTag(params: {
	db: Database
	table: string
	tagName: string
}): AnyRawRecord[] {
	const { db, table, tagName } = params
	return db
		.selectArrays(`SELECT ${RECORD_COLUMN_LIST} FROM ${table} WHERE tagName = ?`, [tagName])
		.map((row) => recordOf({ row }))
		.sort(compareById)
}

/** The records of these ids the table holds, by id: one statement for all of them. */
export function readRecordsById(params: {
	db: Database
	table: string
	ids: readonly string[]
}): Map<string, AnyRawRecord> {
	const { db, table, ids } = params
	const rows = db.selectArrays(
		`SELECT ${RECORD_COLUMN_LIST} FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
		[JSON.stringify(ids)],
	)
	return new Map(rows.map((row) => [String(row[0]), recordOf({ row })]))
}

export function countRecords(params: { db: Database; table: string }): number {
	return Number(params.db.selectValue(`SELECT count(*) FROM ${params.table}`))
}

/**
 * The creates of a bulk write encoded, before anything else is checked: a value the file cannot keep
 * refuses the whole write with `STORE_BULK_ADD_FAILED`.
 */
export function encodeCreates(params: { creates: AnyRawRecord[] }): EncodedRows {
	return encodeOrRefuse({ records: params.creates, key: 'STORE_BULK_ADD_FAILED' })
}

/**
 * A create of an id the table holds, or that the write gives twice, refuses the write
 * (`STORE_DUPLICATE_ID`): the held ids are looked up in one statement.
 */
export function refuseTakenIds(params: {
	db: Database
	table: string
	documentId: string
	creates: AnyRawRecord[]
}): void {
	const { db, table, documentId, creates } = params
	if (creates.length === 0) return
	const ids = creates.map((record) => record.id)
	const heldIds = new Set(readRecordsById({ db, table, ids }).keys())
	const seen = new Set<string>()
	const held: string[] = []
	const repeated: string[] = []
	for (const id of ids) {
		if (heldIds.has(id)) held.push(id)
		if (seen.has(id)) repeated.push(id)
		seen.add(id)
	}
	if (held.length > 0 || repeated.length > 0)
		throwDuplicateRecordIds({ documentId, held, repeated })
}

/**
 * Apply bulk-write patches, in the caller's transaction, in the order given: per batch of ids the
 * records are read in one statement, patched (`applyRecordPatch`, a record patched twice in turn),
 * encoded - a value the file cannot keep refuses with `STORE_BULK_UPDATE_FAILED` - and written back
 * in one statement, one row per record. A patch of a record the table does not hold is skipped.
 */
export function patchRecords(params: {
	db: Database
	table: string
	patches: RecordPatch[]
}): void {
	const { db, table, patches } = params
	if (patches.length === 0) return
	const update = db.prepare(
		`UPDATE ${table} SET ${RECORD_UPDATE_ASSIGNMENTS} FROM (SELECT ${ROW_SELECT_ALIASES} FROM json_each(?) e) AS u ` +
			`WHERE ${table}.id = u.c0`,
	)
	try {
		for (let start = 0; start < patches.length; start += ROWS_PER_BIND) {
			const chunk = patches.slice(start, start + ROWS_PER_BIND)
			const records = readRecordsById({ db, table, ids: chunk.map((patch) => patch.recordId) })
			const patched = new Map<string, AnyRawRecord>()
			for (const patch of chunk) {
				const record = patched.get(patch.recordId) ?? records.get(patch.recordId)
				if (!record) continue
				patched.set(patch.recordId, applyRecordPatch({ record, patch }))
			}
			const rows = encodeOrRefuse({
				records: [...patched.values()],
				key: 'STORE_BULK_UPDATE_FAILED',
			})
			for (const payload of rows.payloads) update.bind([payload]).stepReset()
		}
	} finally {
		update.finalize()
	}
}

/** Delete the records of these ids, in the caller's transaction; answers how many were held. */
export function deleteRecords(params: {
	db: Database
	table: string
	ids: readonly string[]
}): number {
	const { db, table, ids } = params
	if (ids.length === 0) return 0
	db.exec({
		sql: `DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
		bind: [JSON.stringify(ids)],
	})
	return db.changes()
}

function encodeOrRefuse(params: {
	records: AnyRawRecord[]
	key: 'STORE_BULK_ADD_FAILED' | 'STORE_BULK_UPDATE_FAILED'
}): EncodedRows {
	const { records, key } = params
	try {
		return encodeRecords({ records })
	} catch (thrown) {
		const cause = thrown instanceof Error ? thrown : undefined
		throwDialecteError(key, { detail: cause?.message ?? String(thrown), cause })
	}
}

function recordOf(params: { row: SqlValue[] }): AnyRawRecord {
	const [id, tagName, nsPrefix, nsUri, value, parentId, parentTagName, attributes, children] =
		params.row
	return {
		id: String(id),
		tagName: String(tagName),
		namespace: { prefix: String(nsPrefix ?? ''), uri: String(nsUri ?? '') },
		attributes: JSON.parse(String(attributes)) as AnyRawRecord['attributes'],
		value: String(value ?? ''),
		parent: parentId === null ? null : { id: String(parentId), tagName: String(parentTagName) },
		children: JSON.parse(String(children)) as AnyRelationship[],
	}
}
