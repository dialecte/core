import { encodeRecords } from './bulk-insert'
import {
	DUPLICATE_IDS_REPORTED,
	RECORD_COLUMN_LIST,
	RECORD_UPDATE_ASSIGNMENTS,
	ROW_SELECT_ALIASES,
	ROWS_PER_BIND,
} from './engine.constants'

import { applyRecordPatch } from '@/store/apply-record-patch'
import { compareById } from '@/store/compare-by-id'
import { checkJsonValues } from '@/store/json-values'
import { throwDuplicateRecordIds } from '@/store/store-errors'

import type { RecordReadsById } from './engine.types'
import type { AnyRawRecord, AnyRelationship, RecordPatch } from '@/types'
import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'

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

/**
 * Reads by id on one table through one prepared statement, for a caller that reads many times (an
 * export): `read` answers the records of the ids the table holds, `finalize` releases the statement.
 */
export function prepareReadsById(params: { db: Database; table: string }): RecordReadsById {
	const { db, table } = params
	const statement = db.prepare(
		`SELECT ${RECORD_COLUMN_LIST} FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
	)
	return {
		read: function read(ids) {
			const records = new Map<string, AnyRawRecord>()
			try {
				statement.bind([JSON.stringify(ids)])
				while (statement.step()) {
					const record = recordOf({ row: statement.get([]) })
					records.set(record.id, record)
				}
			} finally {
				statement.reset(true)
			}
			return records
		},
		finalize: function finalize() {
			statement.finalize()
		},
	}
}

/** The ids among these the table holds: one statement, no record read. */
export function readHeldIds(params: {
	db: Database
	table: string
	ids: readonly string[]
}): Set<string> {
	const { db, table, ids } = params
	return new Set(
		db
			.selectValues(`SELECT id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, [
				JSON.stringify(ids),
			])
			.map(String),
	)
}

export function countRecords(params: { db: Database; table: string }): number {
	return Number(params.db.selectValue(`SELECT count(*) FROM ${params.table}`))
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
	refuseDuplicateIds({ documentId, ids, heldIds: readHeldIds({ db, table, ids }) })
}

/**
 * Ids to create refused (`STORE_DUPLICATE_ID`) when one is held already or given twice among them;
 * answers the set of the ids given.
 */
export function refuseDuplicateIds(params: {
	documentId: string
	ids: readonly string[]
	heldIds: ReadonlySet<string>
}): Set<string> {
	const { documentId, ids, heldIds } = params
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
	return seen
}

/**
 * A unique id index that could not be built for ids the table holds twice: refused
 * `STORE_DUPLICATE_ID`, naming them (up to `DUPLICATE_IDS_REPORTED`, read on this failure only).
 * Any other failure is left as it is.
 */
export function refuseRepeatedIds(params: {
	sqlite3: Sqlite3Static
	db: Database
	table: string
	documentId: string
	thrown: unknown
}): void {
	const { sqlite3, db, table, documentId, thrown } = params
	const resultCode = (thrown as { resultCode?: number } | undefined)?.resultCode
	if (resultCode !== sqlite3.capi.SQLITE_CONSTRAINT_UNIQUE) return
	const repeated = db
		.selectValues(`SELECT id FROM ${table} GROUP BY id HAVING count(*) > 1 LIMIT ?`, [
			DUPLICATE_IDS_REPORTED,
		])
		.map(String)
	throwDuplicateRecordIds({
		documentId,
		held: [],
		repeated,
		cause: thrown instanceof Error ? thrown : undefined,
	})
}

/**
 * The patches of a write that apply - those of the records the table holds (one statement per batch
 * of ids) - checked as one list, as every store checks them: a value that is not JSON refuses the
 * write with `STORE_VALUE_NOT_JSON`, its place counted among them. A patch of a record the table does
 * not hold is not checked: it is skipped.
 */
export function checkApplyingPatches(params: {
	db: Database
	table: string
	patches: readonly RecordPatch[]
}): void {
	const { db, table, patches } = params
	if (patches.length === 0) return
	const held = new Set<string>()
	for (let start = 0; start < patches.length; start += ROWS_PER_BIND) {
		const ids = patches.slice(start, start + ROWS_PER_BIND).map((patch) => patch.recordId)
		for (const id of readHeldIds({ db, table, ids })) held.add(id)
	}
	checkHeldPatches({ patches, held })
}

/**
 * The patches of the records `held` checked as one list: a value that is not JSON refuses, its place
 * counted among them. Answers them: the write applies those and no other, as one write would.
 */
export function checkHeldPatches(params: {
	patches: readonly RecordPatch[]
	held: ReadonlySet<string>
}): RecordPatch[] {
	const { patches, held } = params
	const applying = patches.filter((patch) => held.has(patch.recordId))
	checkJsonValues({ value: applying })
	return applying
}

/**
 * Apply bulk-write patches already checked (`checkApplyingPatches`), in the caller's transaction, in
 * the order given: per batch of ids the records are read in one statement, the patches of the records
 * held applied (`applyRecordPatch`, a record patched twice in turn), encoded and written back in one
 * statement, one row per record. A patch of a record the table does not hold is skipped.
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
				if (record) patched.set(patch.recordId, applyRecordPatch({ record, patch }))
			}
			const rows = encodeRecords({ records: [...patched.values()] })
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

/** A record from its row, the columns in the order of `RECORD_COLUMNS`. */
export function recordOf(params: { row: SqlValue[] }): AnyRawRecord {
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
