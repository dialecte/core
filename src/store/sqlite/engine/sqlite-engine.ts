import { insertEncodedRows } from './bulk-insert'
import { asStoreFailure } from './engine-errors'
import { DEFAULT_ENGINE_OPTIONS } from './engine.constants'
import {
	countRecords,
	deleteRecords,
	encodeCreates,
	patchRecords,
	readAllRecords,
	readRecord,
	readRecordsById,
	readRecordsByTag,
	refuseTakenIds,
} from './records'
import {
	deleteDocument,
	deleteUnfinishedImports,
	insertDocument,
	readDocument,
	readDocuments,
	readDocumentsByWriteId,
	recordTableOf,
	updateDocumentRow,
} from './registry'
import { prepareFile, reclaimFreePages } from './schema'
import { inWriteTransaction } from './transaction'

import { throwDocumentNotRegistered } from '@/store/store-errors'
import { importOutcomeOf } from '@/store/write-outcome'

import type { EncodedRows, OpenSqliteEngineParams, SqliteEngine } from './engine.types'
import type { AnyRawRecord, RecordPatch } from '@/types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Start the engine of a project on its database: a new file is laid out, a file of another layout
 * refused (`PROJECT_LAYOUT_OUTDATED`), every document an import left `importing` removed. The engine
 * owns the database from then on: a start that fails closes it, so the file stays free.
 *
 * Its methods run synchronously on the one connection and never await while a transaction is open,
 * so no call runs inside another's transaction. A failure of SQLite is thrown as the operation's
 * store error (`STORE_READ_FAILED`, `STORE_COMMIT_FAILED`, ...), the failure as its cause; a refusal
 * passes as it is.
 */
export function openSqliteEngine(params: OpenSqliteEngineParams): SqliteEngine {
	const { sqlite3, db, dialecteId } = params
	const options = { ...DEFAULT_ENGINE_OPTIONS, ...params.options }
	try {
		asStoreFailure({
			key: 'STORE_CONNECTION_FAILED',
			detail: 'The project file could not be opened',
			work: function startOnFile() {
				prepareFile({ sqlite3, db, dialecteId, options })
				inWriteTransaction({
					sqlite3,
					db,
					work: function sweepUnfinishedImports() {
						deleteUnfinishedImports({ db })
					},
				})
				reclaimFreePages({ db })
			},
		})
	} catch (thrown) {
		db.close()
		throw thrown
	}
	/**
	 * Record count per document, read once, then kept in step with the engine's own writes: the engine
	 * is the file's only writer.
	 */
	const counts = new Map<string, number>()

	return {
		registerDocument: async function registerDocument(document) {
			asStoreFailure({
				key: 'STORE_COMMIT_FAILED',
				detail: `Document "${document.id}" could not be registered`,
				work: function registerInTransaction() {
					inWriteTransaction({
						sqlite3,
						db,
						work: function insertRow() {
							insertDocument({ db, document })
						},
					})
				},
			})
			counts.set(document.id, 0)
		},
		getDocument: async function getDocument(documentId) {
			return read({
				detail: `Document "${documentId}"`,
				work: function readOneDocument() {
					return readDocument({ db, documentId })
				},
			})
		},
		getDocuments: async function getDocuments() {
			return read({
				detail: 'The documents',
				work: function readAllDocuments() {
					return readDocuments({ db })
				},
			})
		},
		updateDocument: async function updateDocument(documentId, updates) {
			asStoreFailure({
				key: 'STORE_COMMIT_FAILED',
				detail: `Document "${documentId}" could not be updated`,
				work: function updateInTransaction() {
					inWriteTransaction({
						sqlite3,
						db,
						work: function updateRow() {
							updateDocumentRow({ db, documentId, updates })
						},
					})
				},
			})
		},
		/**
		 * The free pages are given back once the removal is committed: a failure there is reported as
		 * a failed removal of a document that is gone; removing it again is harmless (an unknown id is
		 * ignored, the free pages reclaimed then).
		 */
		removeDocument: async function removeDocument(documentId) {
			asStoreFailure({
				key: 'STORE_DELETE_FAILED',
				detail: `Document "${documentId}" could not be removed`,
				work: function removeAndReclaim() {
					inWriteTransaction({
						sqlite3,
						db,
						work: function deleteRowAndTable() {
							deleteDocument({ db, documentId })
						},
					})
					counts.delete(documentId)
					reclaimFreePages({ db })
				},
			})
		},
		get: async function get(id, documentId) {
			return read({
				detail: `Record "${id}" of document "${documentId}"`,
				work: function readOne() {
					const table = recordTableOf({ db, documentId })
					return table ? readRecord({ db, table, id }) : undefined
				},
			})
		},
		getByDocumentId: async function getByDocumentId(documentId) {
			return read({
				detail: `The records of document "${documentId}"`,
				work: function readAll() {
					const table = recordTableOf({ db, documentId })
					return table ? readAllRecords({ db, table }) : []
				},
			})
		},
		count: async function count(documentId) {
			const held = counts.get(documentId)
			if (held !== undefined) return held
			return read({
				detail: `The record count of document "${documentId}"`,
				work: function countOnce() {
					const table = recordTableOf({ db, documentId })
					if (!table) return 0
					const counted = countRecords({ db, table })
					counts.set(documentId, counted)
					return counted
				},
			})
		},
		getByTagNameInDocument: async function getByTagNameInDocument(tagName, documentId) {
			return read({
				detail: `The ${tagName} records of document "${documentId}"`,
				work: function readByTag() {
					const table = recordTableOf({ db, documentId })
					return table ? readRecordsByTag({ db, table, tagName }) : []
				},
			})
		},
		getMany: async function getMany(ids, documentId) {
			return read({
				detail: `Records of document "${documentId}"`,
				work: function readMany() {
					const table = recordTableOf({ db, documentId })
					if (!table) return ids.map(() => undefined)
					const records = readRecordsById({ db, table, ids })
					return ids.map((id) => records.get(id))
				},
			})
		},
		getWriteOutcome: async function getWriteOutcome({ writeId }) {
			return read({
				detail: `The outcome of write "${writeId}"`,
				work: function outcomeFromRegistry() {
					const documents = readDocumentsByWriteId({ db, writeId })
					return importOutcomeOf({ documents, writeId })
				},
			})
		},
		/**
		 * Refused whole, in the order every store answers in: a document not registered, a create the
		 * file cannot keep, a taken id; then, in the transaction, a patch the file cannot keep.
		 */
		bulkWrite: async function bulkWrite(documentId, ops) {
			const { creates = [], updates = [], deletes = [] } = ops
			const deleted = writeRecords({ sqlite3, db, documentId, creates, updates, deletes })
			const held = counts.get(documentId)
			if (held !== undefined) counts.set(documentId, held + creates.length - deleted)
		},
		close: function closeEngine() {
			db.close()
		},
	}
}

function read<GenericResult>(params: { detail: string; work: () => GenericResult }): GenericResult {
	const { detail, work } = params
	return asStoreFailure({ key: 'STORE_READ_FAILED', detail: `${detail} could not be read`, work })
}

/** A bulk write in one transaction; answers how many records it deleted. */
function writeRecords(params: {
	sqlite3: Sqlite3Static
	db: Database
	documentId: string
	creates: AnyRawRecord[]
	updates: RecordPatch[]
	deletes: string[]
}): number {
	const { sqlite3, db, documentId, creates, updates, deletes } = params
	const detail = `Records of document "${documentId}" could not be written`
	const table = read({
		detail: `Document "${documentId}"`,
		work: function findTable() {
			return recordTableOf({ db, documentId })
		},
	})
	if (!table) throwDocumentNotRegistered({ documentId, what: 'records' })
	const rows = encodeCreates({ creates })
	read({
		detail: `The ids of document "${documentId}"`,
		work: function checkIds() {
			refuseTakenIds({ db, table, documentId, creates })
		},
	})
	return asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail,
		work: function writeInTransaction() {
			return inWriteTransaction({
				sqlite3,
				db,
				work: function writeAll() {
					return writeRows({ db, table, rows, updates, deletes, detail })
				},
			})
		},
	})
}

/**
 * The rows of a bulk write, in the caller's transaction, each part's failure under its own key;
 * answers how many records it deleted.
 */
function writeRows(params: {
	db: Database
	table: string
	rows: EncodedRows
	updates: RecordPatch[]
	deletes: string[]
	detail: string
}): number {
	const { db, table, rows, updates, deletes, detail } = params
	asStoreFailure({
		key: 'STORE_BULK_ADD_FAILED',
		detail,
		work: function insertCreates() {
			insertEncodedRows({ db, table, rows })
		},
	})
	asStoreFailure({
		key: 'STORE_BULK_UPDATE_FAILED',
		detail,
		work: function applyPatches() {
			patchRecords({ db, table, patches: updates })
		},
	})
	return asStoreFailure({
		key: 'STORE_DELETE_FAILED',
		detail,
		work: function deleteIds() {
			return deleteRecords({ db, table, ids: deletes })
		},
	})
}
