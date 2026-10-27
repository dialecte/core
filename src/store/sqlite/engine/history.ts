import { insertEncodedRows } from './bulk-insert'
import {
	HISTORY_ENTRY_STATE,
	HISTORY_PART,
	RECORD_COLUMN_LIST,
	RECORD_COLUMN_NAMES,
} from './engine.constants'
import { recordOf } from './records'

import { TABLE_CHANGELOG } from '@/store/store.constants'

import type {
	EncodedRows,
	HistoryDirection,
	HistoryEntryRef,
	HistoryEntryState,
	HistoryPart,
} from './engine.types'
import type { ChangeLogEntry } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * The history of a document on the file: one `_changeLog` row per commit, and the records it touched
 * whole in the document's history-rows table, one row per record and part, in the order given. The
 * entries applied are the first ones in sequence; an undo leaves its entry undone until a redo applies
 * it again or a commit discards it. Every write runs in the caller's transaction.
 */

/**
 * A new entry, applied, after the document's last: the entries undone before it are discarded first
 * - their rows gone, their place freed, their write ids kept. Answers the entry.
 */
export function recordEntry(params: {
	db: Database
	documentId: string
	table: string
	writeId: string
}): HistoryEntryRef {
	const { db, documentId, table, writeId } = params
	db.exec({
		sql: `DELETE FROM ${table} WHERE entry IN (SELECT id FROM ${TABLE_CHANGELOG} WHERE documentId = ? AND state = ?)`,
		bind: [documentId, HISTORY_ENTRY_STATE.undone],
	})
	db.exec({
		sql: `UPDATE ${TABLE_CHANGELOG} SET state = ?, sequenceNumber = NULL WHERE documentId = ? AND state = ?`,
		bind: [HISTORY_ENTRY_STATE.discarded, documentId, HISTORY_ENTRY_STATE.undone],
	})
	const head = Number(
		db.selectValue(
			`SELECT coalesce(max(sequenceNumber), 0) FROM ${TABLE_CHANGELOG} WHERE documentId = ?`,
			[documentId],
		),
	)
	db.exec({
		sql: `INSERT INTO ${TABLE_CHANGELOG} (documentId, sequenceNumber, timestamp, writeId, state) VALUES (?, ?, ?, ?, ?)`,
		bind: [documentId, head + 1, Date.now(), writeId, HISTORY_ENTRY_STATE.applied],
	})
	return { id: Number(db.selectValue('SELECT last_insert_rowid()')) }
}

/**
 * The records of these ids the document holds, copied whole into the entry's part, in the order of
 * the ids (an id it does not hold is left out).
 */
export function copySnapshots(params: {
	db: Database
	records: string
	table: string
	entry: HistoryEntryRef
	part: HistoryPart
	ids: readonly string[]
}): void {
	const { db, records, table, entry, part, ids } = params
	if (ids.length === 0) return
	db.exec({
		sql:
			`INSERT INTO ${table} (entry, part, ${RECORD_COLUMN_LIST}) ` +
			`SELECT ?, ?, ${RECORD_COLUMN_NAMES.map((column) => `t.${column}`).join(', ')} FROM json_each(?) j ` +
			`JOIN ${records} t ON t.id = j.value ORDER BY j.key`,
		bind: [entry.id, HISTORY_PART[part], JSON.stringify(ids)],
	})
}

/** Records encoded for the row sink, written as the entry's part in the order given. */
export function appendSnapshots(params: {
	db: Database
	table: string
	entry: HistoryEntryRef
	part: HistoryPart
	rows: EncodedRows
}): void {
	const { db, table, entry, part, rows } = params
	insertEncodedRows({
		db,
		table,
		rows,
		lead: { columns: ['entry', 'part'], values: [entry.id, HISTORY_PART[part]] },
	})
}

/**
 * Apply an entry to the document's records: `forward` (a redo) writes its creates and its updates as
 * they were after it, then deletes what it deleted; `back` (an undo), in reverse, writes back what it
 * deleted, then its updates as they were before it, then deletes its creates. Answers how many records
 * the document gained (negative when it lost some).
 */
export function applyEntry(params: {
	db: Database
	records: string
	table: string
	entry: HistoryEntryRef
	direction: HistoryDirection
}): number {
	const { direction, ...target } = params
	if (direction === 'forward') {
		return (
			writePartRecords({ ...target, part: 'create' }) +
			writePartRecords({ ...target, part: 'after' }) -
			deletePartRecords({ ...target, part: 'delete' })
		)
	}
	return (
		writePartRecords({ ...target, part: 'delete' }) +
		writePartRecords({ ...target, part: 'before' }) -
		deletePartRecords({ ...target, part: 'create' })
	)
}

/**
 * The rows of the part written over the records of their ids, whatever the document holds there, in
 * the order the entry keeps (the last of two updates of a record stands); answers how many of them the
 * document did not hold.
 */
export function writePartRecords(params: {
	db: Database
	records: string
	table: string
	entry: HistoryEntryRef
	part: HistoryPart
}): number {
	const { db, records, table, entry, part } = params
	const bind = [entry.id, HISTORY_PART[part]]
	const added = Number(
		db.selectValue(
			`SELECT count(DISTINCT h.id) FROM ${table} h WHERE h.entry = ? AND h.part = ? ` +
				`AND NOT EXISTS (SELECT 1 FROM ${records} t WHERE t.id = h.id)`,
			bind,
		),
	)
	db.exec({
		sql:
			`INSERT OR REPLACE INTO ${records} (${RECORD_COLUMN_LIST}) ` +
			`SELECT ${RECORD_COLUMN_LIST} FROM ${table} WHERE entry = ? AND part = ? ORDER BY rowNo`,
		bind,
	})
	return added
}

/** The records of the ids the part holds deleted; answers how many there were. */
export function deletePartRecords(params: {
	db: Database
	records: string
	table: string
	entry: HistoryEntryRef
	part: HistoryPart
}): number {
	const { db, records, table, entry, part } = params
	db.exec({
		sql: `DELETE FROM ${records} WHERE id IN (SELECT id FROM ${table} WHERE entry = ? AND part = ?)`,
		bind: [entry.id, HISTORY_PART[part]],
	})
	return db.changes()
}

/** The entry an undo of the document reverts: its last applied one; none at the start of its history. */
export function entryToUndo(params: {
	db: Database
	documentId: string
}): HistoryEntryRef | undefined {
	const { db, documentId } = params
	const id = db.selectValue(
		`SELECT id FROM ${TABLE_CHANGELOG} WHERE documentId = ? AND state = ? ORDER BY sequenceNumber DESC LIMIT 1`,
		[documentId, HISTORY_ENTRY_STATE.applied],
	)
	return id === undefined ? undefined : { id: Number(id) }
}

/** The entry a redo of the document applies again: its first undone one; none at the end of its history. */
export function entryToRedo(params: {
	db: Database
	documentId: string
}): HistoryEntryRef | undefined {
	const { db, documentId } = params
	const id = db.selectValue(
		`SELECT id FROM ${TABLE_CHANGELOG} WHERE documentId = ? AND state = ? ORDER BY sequenceNumber LIMIT 1`,
		[documentId, HISTORY_ENTRY_STATE.undone],
	)
	return id === undefined ? undefined : { id: Number(id) }
}

/** Move the entry to applied (a redo) or undone (an undo). */
export function setEntryState(params: {
	db: Database
	entry: HistoryEntryRef
	state: HistoryEntryState
}): void {
	const { db, entry, state } = params
	db.exec({
		sql: `UPDATE ${TABLE_CHANGELOG} SET state = ? WHERE id = ?`,
		bind: [HISTORY_ENTRY_STATE[state], entry.id],
	})
}

/** Whether the document has a commit to undo and one to redo. */
export function readHistoryStatus(params: { db: Database; documentId: string }): {
	canUndo: boolean
	canRedo: boolean
} {
	const { db, documentId } = params
	const exists = `EXISTS (SELECT 1 FROM ${TABLE_CHANGELOG} WHERE documentId = ? AND state = ?)`
	const [row] = db.selectArrays(`SELECT ${exists}, ${exists}`, [
		documentId,
		HISTORY_ENTRY_STATE.applied,
		documentId,
		HISTORY_ENTRY_STATE.undone,
	])
	return { canUndo: Number(row?.[0]) === 1, canRedo: Number(row?.[1]) === 1 }
}

/** The document's entries in sequence order (a discarded one is not), each with its records whole, read in two statements. */
export function readChangeLog(params: {
	db: Database
	documentId: string
	table: string
}): ChangeLogEntry[] {
	const { db, documentId, table } = params
	const entries = new Map<number, ChangeLogEntry>()
	const befores = new Map<number, AnyRawRecord[]>()
	const afters = new Map<number, AnyRawRecord[]>()
	for (const [id, sequenceNumber, timestamp, writeId] of db.selectArrays(
		`SELECT id, sequenceNumber, timestamp, writeId FROM ${TABLE_CHANGELOG} WHERE documentId = ? AND state != ? ORDER BY sequenceNumber`,
		[documentId, HISTORY_ENTRY_STATE.discarded],
	)) {
		entries.set(Number(id), {
			id: Number(id),
			documentId,
			sequenceNumber: Number(sequenceNumber),
			timestamp: Number(timestamp),
			writeId: String(writeId),
			operations: { creates: [], updates: [], deletes: [] },
		})
		befores.set(Number(id), [])
		afters.set(Number(id), [])
	}
	if (entries.size === 0) return []
	for (const [entryId, part, ...row] of db.selectArrays(
		`SELECT entry, part, ${RECORD_COLUMN_LIST} FROM ${table} ORDER BY rowNo`,
	)) {
		const entry = entries.get(Number(entryId))
		if (!entry) continue
		const record = recordOf({ row })
		if (part === HISTORY_PART.create) entry.operations.creates.push(record)
		if (part === HISTORY_PART.before) befores.get(entry.id)!.push(record)
		if (part === HISTORY_PART.after) afters.get(entry.id)!.push(record)
		if (part === HISTORY_PART.delete) entry.operations.deletes.push(record)
	}
	for (const entry of entries.values()) {
		const after = afters.get(entry.id)!
		entry.operations.updates = befores
			.get(entry.id)!
			.map((before, index) => ({ before, after: after[index]! }))
	}
	return [...entries.values()]
}

/** Whether a history entry of any document carries the id, discarded or not: its commit is applied. */
export function hasCommitOf(params: { db: Database; writeId: string }): boolean {
	const { db, writeId } = params
	return (
		db.selectValue(`SELECT 1 FROM ${TABLE_CHANGELOG} WHERE writeId = ? LIMIT 1`, [writeId]) !==
		undefined
	)
}

/** A document's history gone, in the caller's transaction: its history-rows table and its entries. */
export function deleteHistoryOf(params: { db: Database; documentId: string; table: string }): void {
	const { db, documentId, table } = params
	db.exec(`DROP TABLE ${table}`)
	db.exec({ sql: `DELETE FROM ${TABLE_CHANGELOG} WHERE documentId = ?`, bind: [documentId] })
}
