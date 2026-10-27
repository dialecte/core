import { encodeCheckedRecords } from './bulk-insert'
import { asReadFailure, asStoreFailure } from './engine-errors'
import { ROWS_PER_BIND } from './engine.constants'
import {
	appendSnapshots,
	applyEntry,
	copySnapshots,
	deletePartRecords,
	entryToRedo,
	entryToUndo,
	recordEntry,
	setEntryState,
	writePartRecords,
} from './history'
import { readHeldIds, refuseTakenIds } from './records'
import { documentTablesOf } from './registry'
import { inWriteTransaction } from './transaction'

import { throwDocumentNotRegistered, throwRecordToUpdateNotFound } from '@/store/store-errors'

import type { CommitRecordsParams, HistoryStepParams } from './engine.types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * A commit on the file: refused whole before anything is written, in the order every store answers
 * in - a document not registered (or still importing), an update of a record it does not hold, a
 * create that is not JSON, a taken or repeated id, an update that is not JSON. Then, once the import
 * that runs is settled, one durable transaction: the redo future discarded, the entry recorded with
 * the records it touches whole - the updated ones as they are, the created and updated ones as given -
 * the creates and the updates written, then the records the deletes find kept as they are at that
 * step and deleted. Answers how many records the document gained (negative when it lost some).
 */
export function commitRecords(params: CommitRecordsParams): number {
	const { sqlite3, db, documentId, writeId, creates, updates, deletes, settle } = params
	const tables = asReadFailure({
		detail: `Document "${documentId}"`,
		work: function findTables() {
			return documentTablesOf({ db, documentId })
		},
	})
	if (!tables) throwDocumentNotRegistered({ documentId, what: 'records' })
	// an import table has no unique id index yet, and nothing commits on a document before it is ready
	if (tables.status === 'importing') throwDocumentNotRegistered({ documentId, what: 'a commit' })
	asReadFailure({
		detail: `The records to update in document "${documentId}"`,
		work: function checkUpdatesHeld() {
			refuseAbsentUpdates({ db, table: tables.records, documentId, ids: updates.map(idOf) })
		},
	})
	const createRows = encodeCheckedRecords({ records: creates })
	asReadFailure({
		detail: `The ids of document "${documentId}"`,
		work: function checkIds() {
			refuseTakenIds({ db, table: tables.records, documentId, creates })
		},
	})
	const afterRows = encodeCheckedRecords({ records: updates })
	return asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail: `The commit on document "${documentId}" could not be written`,
		work: function commitInTransaction() {
			settle()
			return inWriteTransaction({
				sqlite3,
				db,
				work: function recordAndApply() {
					const entry = recordEntry({ db, documentId, table: tables.history, writeId })
					const target = { db, records: tables.records, table: tables.history, entry }
					copySnapshots({ ...target, part: 'before', ids: updates.map(idOf) })
					appendSnapshots({ db, table: tables.history, entry, part: 'create', rows: createRows })
					appendSnapshots({ db, table: tables.history, entry, part: 'after', rows: afterRows })
					const added =
						writePartRecords({ ...target, part: 'create' }) +
						writePartRecords({ ...target, part: 'after' })
					copySnapshots({ ...target, part: 'delete', ids: deletes })
					return added - deletePartRecords({ ...target, part: 'delete' })
				},
			})
		},
	})
}

/**
 * An undo (`back`) or a redo (`forward`) of the document's history: its last applied entry reverted,
 * or its first undone one applied again, in one durable transaction once the import that runs is
 * settled. Answers how many records the document gained, or `undefined` when there was nothing to do
 * (a document not registered, the start or the end of its history): nothing written then.
 */
export function stepHistory(params: HistoryStepParams): number | undefined {
	const { sqlite3, db, documentId, direction, settle } = params
	const found = asReadFailure({
		detail: `The history of document "${documentId}"`,
		work: function findEntry() {
			const tables = documentTablesOf({ db, documentId })
			if (!tables) return undefined
			const entry =
				direction === 'back' ? entryToUndo({ db, documentId }) : entryToRedo({ db, documentId })
			return entry && { tables, entry }
		},
	})
	if (!found) return undefined
	const { tables, entry } = found
	return asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail: `The ${direction === 'back' ? 'undo' : 'redo'} on document "${documentId}" could not be written`,
		work: function stepInTransaction() {
			settle()
			return inWriteTransaction({
				sqlite3,
				db,
				work: function applyAndMark() {
					const gained = applyEntry({
						db,
						records: tables.records,
						table: tables.history,
						entry,
						direction,
					})
					setEntryState({ db, entry, state: direction === 'forward' ? 'applied' : 'undone' })
					return gained
				},
			})
		},
	})
}

/** An update of a record the document does not hold refuses the commit: the first such one, in the order given. */
function refuseAbsentUpdates(params: {
	db: Database
	table: string
	documentId: string
	ids: readonly string[]
}): void {
	const { db, table, documentId, ids } = params
	for (let start = 0; start < ids.length; start += ROWS_PER_BIND) {
		const chunk = ids.slice(start, start + ROWS_PER_BIND)
		const held = readHeldIds({ db, table, ids: chunk })
		const absent = chunk.find((id) => !held.has(id))
		if (absent !== undefined) throwRecordToUpdateNotFound({ documentId, recordId: absent })
	}
}

function idOf(record: { id: string }): string {
	return record.id
}
