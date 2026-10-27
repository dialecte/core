import { deleteBlobsOf } from './blobs'
import {
	DOCUMENT_COLUMN_LIST,
	DOCUMENT_COLUMNS,
	TABLE_HISTORY_ROWS_PREFIX,
} from './engine.constants'
import { deleteHistoryOf } from './history'
import { createHistoryRowsTable, createRecordTable } from './schema'

import { compareById } from '@/store/compare-by-id'
import { toJsonCopy } from '@/store/json-values'
import { throwDocumentAlreadyRegistered } from '@/store/store-errors'
import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'

import type { DocumentTable, DocumentTables } from './engine.types'
import type { DocumentRecord, DocumentStatus } from '@/project/types'
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm'

/**
 * Register a document and create its record table without indexes and its history-rows table, in the
 * caller's transaction; answers the row's number and the record table. An id already registered is refused with
 * `STORE_DUPLICATE_ID`, the registered one left as it was, then a value that is not JSON with
 * `STORE_VALUE_NOT_JSON`.
 */
export function insertDocument(params: { db: Database; document: DocumentRecord }): DocumentTable {
	const { db } = params
	if (findSeq({ db, documentId: params.document.id }) !== undefined) {
		throwDocumentAlreadyRegistered({ documentId: params.document.id })
	}
	const document = toJsonCopy({ value: params.document })
	const placeholders = Object.keys(DOCUMENT_COLUMNS)
		.map(() => '?')
		.join(', ')
	db.exec({
		sql: `INSERT INTO ${TABLE_DOCUMENTS} (${DOCUMENT_COLUMN_LIST}) VALUES (${placeholders})`,
		bind: documentRow({ document }),
	})
	const seq = Number(db.selectValue('SELECT last_insert_rowid()'))
	const table = recordTableOfSeq({ seq })
	createRecordTable({ db, table })
	createHistoryRowsTable({ db, table: historyTableOfSeq({ seq }) })
	return { seq, table }
}

/** A document's row number and status, read by its id; none when it is not registered. */
export function readDocumentState(params: {
	db: Database
	documentId: string
}): { seq: number; status: DocumentStatus } | undefined {
	const { db, documentId } = params
	const [row] = db.selectArrays(`SELECT seq, status FROM ${TABLE_DOCUMENTS} WHERE id = ?`, [
		documentId,
	])
	return row ? { seq: Number(row[0]), status: statusOf({ value: row[1]! }) } : undefined
}

/**
 * Mark an imported document ready, in the caller's transaction; answers whether it was there, still
 * `importing` - a document removed meanwhile is never marked.
 */
export function markImportReady(params: { db: Database; documentId: string }): boolean {
	const { db, documentId } = params
	db.exec({
		sql: `UPDATE ${TABLE_DOCUMENTS} SET status = ? WHERE id = ? AND status = ?`,
		bind: ['ready', documentId, 'importing'],
	})
	return db.changes() === 1
}

export function readDocument(params: {
	db: Database
	documentId: string
}): DocumentRecord | undefined {
	const { db, documentId } = params
	const [row] = db.selectArrays(
		`SELECT ${DOCUMENT_COLUMN_LIST} FROM ${TABLE_DOCUMENTS} WHERE id = ?`,
		[documentId],
	)
	return row ? documentOf({ row }) : undefined
}

/** Every registered document, in id order. */
export function readDocuments(params: { db: Database }): DocumentRecord[] {
	const rows = params.db.selectArrays(`SELECT ${DOCUMENT_COLUMN_LIST} FROM ${TABLE_DOCUMENTS}`)
	// the port's order: ids by UTF-16 code unit (SQLite would compare by code point)
	return rows.map((row) => documentOf({ row })).sort(compareById)
}

/**
 * The name, metadata and status of a registered document, in the caller's transaction: a value that
 * is not JSON is refused with `STORE_VALUE_NOT_JSON` first; an unknown document is then left alone.
 */
export function updateDocumentRow(params: {
	db: Database
	documentId: string
	updates: Partial<Pick<DocumentRecord, 'name' | 'metadata' | 'status'>>
}): void {
	const { db, documentId } = params
	const updates = toJsonCopy({ value: params.updates })
	const held = readDocument({ db, documentId })
	if (!held) return
	const updated = { ...held, ...updates }
	db.exec({
		sql: `UPDATE ${TABLE_DOCUMENTS} SET name = ?, metadata = ?, status = ? WHERE id = ?`,
		bind: [updated.name, metadataColumn({ document: updated }), updated.status, documentId],
	})
}

/**
 * A document gone, in the caller's transaction: its record table, its history (its history-rows table
 * and its entries), the blobs it owns, its registry row. An unknown one is ignored.
 */
export function deleteDocument(params: { db: Database; documentId: string }): void {
	const { db, documentId } = params
	const seq = findSeq({ db, documentId })
	if (seq === undefined) return
	purgeDocument({ db, documentId, seq })
}

/** The record table of a registered document; none for a document that is not registered. */
export function recordTableOf(params: { db: Database; documentId: string }): string | undefined {
	const seq = findSeq(params)
	return seq === undefined ? undefined : recordTableOfSeq({ seq })
}

/** The record and history-rows tables of a registered document; none for a document that is not registered. */
export function documentTablesOf(params: {
	db: Database
	documentId: string
}): DocumentTables | undefined {
	const state = readDocumentState(params)
	if (!state) return undefined
	const { seq, status } = state
	return { seq, status, records: recordTableOfSeq({ seq }), history: historyTableOfSeq({ seq }) }
}

/** Everything of a document, its registry row last: one function for every removal. */
function purgeDocument(params: { db: Database; documentId: string; seq: number }): void {
	const { db, documentId, seq } = params
	db.exec(`DROP TABLE ${recordTableOfSeq({ seq })}`)
	deleteHistoryOf({ db, documentId, table: historyTableOfSeq({ seq }) })
	deleteBlobsOf({ db, documentId })
	db.exec({ sql: `DELETE FROM ${TABLE_DOCUMENTS} WHERE seq = ?`, bind: [seq] })
}

function findSeq(params: { db: Database; documentId: string }): number | undefined {
	const { db, documentId } = params
	const seq = db.selectValue(`SELECT seq FROM ${TABLE_DOCUMENTS} WHERE id = ?`, [documentId])
	return seq === undefined ? undefined : Number(seq)
}

/**
 * The table name is built from the registry's row number, never from the document id. A removed
 * document's number may be given again: its table was dropped in the transaction that freed it.
 */
function recordTableOfSeq(params: { seq: number }): string {
	return `${TABLE_RECORD_PREFIX}${params.seq}`
}

/** A document's history-rows table, numbered as its record table. */
function historyTableOfSeq(params: { seq: number }): string {
	return `${TABLE_HISTORY_ROWS_PREFIX}${params.seq}`
}

function documentRow(params: { document: DocumentRecord }): SqlValue[] {
	const { document } = params
	return [
		document.id,
		document.name,
		document.extension,
		document.configKey,
		document.createdAt,
		metadataColumn({ document }),
		document.status,
		document.writeId ?? null,
	]
}

/** The metadata of a document already checked as JSON. */
function metadataColumn(params: { document: Pick<DocumentRecord, 'metadata'> }): string | null {
	const { metadata } = params.document
	return metadata === undefined ? null : JSON.stringify(metadata)
}

function documentOf(params: { row: SqlValue[] }): DocumentRecord {
	const [id, name, extension, configKey, createdAt, metadata, status, writeId] = params.row
	const document: DocumentRecord = {
		id: String(id),
		name: String(name),
		extension: String(extension),
		configKey: String(configKey),
		createdAt: Number(createdAt),
		status: statusOf({ value: status }),
	}
	if (metadata !== null) document.metadata = JSON.parse(String(metadata))
	if (writeId !== null) document.writeId = String(writeId)
	return document
}

function statusOf(params: { value: SqlValue }): DocumentStatus {
	return params.value === 'importing' ? 'importing' : 'ready'
}

/**
 * Every document left `importing` gone with all it has, in the caller's transaction: no import
 * outlives its engine, so at an engine start such a document is a leftover (a closed tab, a crash).
 */
export function deleteUnfinishedImports(params: { db: Database }): void {
	const { db } = params
	const rows = db.selectArrays(`SELECT seq, id FROM ${TABLE_DOCUMENTS} WHERE status = ?`, [
		'importing',
	])
	for (const [seq, documentId] of rows) {
		purgeDocument({ db, documentId: String(documentId), seq: Number(seq) })
	}
}

/** The documents written by the write of that id (one at most). */
export function readDocumentsByWriteId(params: {
	db: Database
	writeId: string
}): DocumentRecord[] {
	const { db, writeId } = params
	return db
		.selectArrays(`SELECT ${DOCUMENT_COLUMN_LIST} FROM ${TABLE_DOCUMENTS} WHERE writeId = ?`, [
			writeId,
		])
		.map((row) => documentOf({ row }))
}
