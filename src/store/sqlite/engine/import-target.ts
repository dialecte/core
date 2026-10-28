import { insertRecords } from './bulk-insert'
import { asReadFailure, asStoreFailure } from './engine-errors'
import { RECORD_INDEXES, ROWS_PER_BIND } from './engine.constants'
import { endQuietly } from './import-window'
import {
	checkHeldPatches,
	deleteRecords,
	patchRecords,
	readHeldIds,
	refuseDuplicateIds,
	refuseRepeatedIds,
	refuseTakenIds,
} from './records'
import { insertDocument, markImportReady, readDocument, readDocumentState } from './registry'
import { createRecordIndex } from './schema'
import { inWriteTransaction } from './transaction'

import { checkJsonValues } from '@/store/json-values'
import { throwDocumentNotRegistered } from '@/store/store-errors'
import { invariant } from '@/utils'
import { tellListener } from '@/utils/tell-listener'
import { throwIfAborted } from '@/xml/parse/parse-xml-document'

import type {
	ImportProgressRelay,
	ImportTargetParams,
	ImportTargetState,
	RecordIndex,
} from './engine.types'
import type { ImportControl, ImportProgress, ImportTarget } from '@/store/store.types'
import type { AnyRawRecord, RecordPatch } from '@/types'
import type { Database } from '@sqlite.org/sqlite-wasm'

/**
 * What one import writes through in the engine (`runImport`'s target). The document's table starts
 * without indexes (an index kept up by every insert of a large file slows it a lot); the id index is
 * built at the first update or delete, the remaining ones once the file is stored, before the
 * document is ready - a document is never ready without them. Reads of a document while it imports
 * scan its table; nothing reads a document that is not ready.
 *
 * Every member checks the import's abort before it touches the database, so an import resumed after
 * the engine closed stops there. The registry row is read again before each write: a document
 * removed meanwhile (its number possibly taken by another one) is never written to nor marked ready.
 */
export function createImportTarget(params: ImportTargetParams): ImportTarget {
	const { sqlite3, db, signal, file, counts, removeDocument } = params
	const state: ImportTargetState = {
		registered: undefined,
		built: new Set(),
		givenIds: params.customIds ? new Set() : undefined,
	}
	return {
		registerDocument: async function registerImported(document) {
			throwIfAborted({ signal, file })
			const documentTable = asStoreFailure({
				key: 'STORE_COMMIT_FAILED',
				detail: `Document "${document.id}" could not be registered`,
				work: function registerInTransaction() {
					return inWriteTransaction({
						sqlite3,
						db,
						work: function insertBare() {
							return insertDocument({ db, document })
						},
					})
				},
			})
			state.registered = { ...documentTable, documentId: document.id }
			counts.set(document.id, 0)
		},
		getDocument: async function getImported(documentId) {
			throwIfAborted({ signal, file })
			return asReadFailure({
				detail: `Document "${documentId}"`,
				work: function readOne() {
					return readDocument({ db, documentId })
				},
			})
		},
		/** The records of the file, then the session's writes: creates, updates, deletes, in that order. */
		bulkWrite: async function writeImported(documentId, ops) {
			const { creates = [], updates = [], deletes = [] } = ops
			if (creates.length > 0) await writeCreates({ params, state, documentId, creates })
			if (updates.length === 0 && deletes.length === 0) return
			if (!state.built.has('id')) await buildIndex({ params, state, documentId, index: 'id' })
			await writeChanges({ params, state, documentId, updates, deletes })
		},
		/**
		 * The import's one update: the document ready, once its table has every index. A document
		 * removed meanwhile is refused `DOCUMENT_NOT_REGISTERED`, never marked.
		 */
		updateDocument: async function markReady(documentId, updates) {
			invariant(updates.status === 'ready' && Object.keys(updates).length === 1, {
				detail: `An import only marks its document ready, not ${JSON.stringify(updates)}`,
			})
			for (const index of Object.keys(RECORD_INDEXES) as RecordIndex[]) {
				if (!state.built.has(index)) await buildIndex({ params, state, documentId, index })
			}
			markOwnReady({ params, state, documentId })
		},
		/**
		 * What a failed or aborted import leaves goes: its own row only (by its number), never a
		 * document registered since under the same id.
		 */
		removeDocument: async function removeImported(documentId) {
			const { registered } = state
			// nothing to remove on a closed engine: no import outlives it, the next start sweeps
			if (registered?.documentId !== documentId || !db.isOpen()) return
			endQuietly({ window: params.window })
			// a document of that id registered since by another connection is not this import's
			const row = readRegistryRow({ db, documentId })
			if (row?.seq !== registered.seq || row.status !== 'importing') return
			await removeDocument({ documentId })
		},
	}
}

/** The table of the document this import registered, while its row is still this import's own. */
function ownTable(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
}): string {
	const { state, documentId } = params
	const { db, signal, file } = params.params
	throwIfAborted({ signal, file })
	const { registered } = state
	const row = readRegistryRow({ db, documentId })
	if (
		registered?.documentId !== documentId ||
		row?.seq !== registered.seq ||
		row.status !== 'importing'
	) {
		throwDocumentNotRegistered({ documentId, what: 'records' })
	}
	return registered.table
}

/**
 * Records into the import's windows: the whole set checked first, in every store's order - a value
 * that is not JSON, then an id taken (looked up once the id index exists; before it, the ids a file
 * gives itself against the ones stored; a create of the session repeating one is caught by the index
 * build) - then stored a bind at a time, the window's time checked after each (the session's creates
 * may be many).
 */
async function writeCreates(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	creates: AnyRawRecord[]
}): Promise<void> {
	const { state, documentId, creates } = params
	const { db, perf, counts, window } = params.params
	const detail = `Records of document "${documentId}" could not be written`
	const table = ownTable(params)
	perf.time('import::encode', function checkValues() {
		checkJsonValues({ value: creates })
	})
	asStoreFailure({
		key: 'STORE_BULK_ADD_FAILED',
		detail,
		work: function refuseTaken() {
			refuseIdsOfBatch({ db, table, state, documentId, creates })
		},
	})
	for (let start = 0; start < creates.length; start += ROWS_PER_BIND) {
		const records = creates.slice(start, start + ROWS_PER_BIND)
		const own = start === 0 ? table : ownTable(params)
		asStoreFailure({
			key: 'STORE_BULK_ADD_FAILED',
			detail,
			work: function insertInWindow() {
				window.write(function insertBind() {
					insertRecords({ db, table: own, records, perf })
				})
			},
		})
		counts.set(documentId, (counts.get(documentId) ?? 0) + records.length)
		await commitAtCap({ params: params.params, documentId })
	}
}

/**
 * The session's updates, then its deletes, a batch at a time in the import's windows (each part's
 * failure under its own key), the window's time checked after each batch.
 */
async function writeChanges(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	updates: RecordPatch[]
	deletes: string[]
}): Promise<void> {
	const { documentId, updates, deletes } = params
	const { db, counts, window } = params.params
	const detail = `Records of document "${documentId}" could not be written`
	// the patches checked are the ones applied: a record created since by another write is not patched
	const applying = await checkPatchesInTurns({
		params: params.params,
		state: params.state,
		documentId,
		updates,
	})
	for (let start = 0; start < applying.length; start += ROWS_PER_BIND) {
		const table = ownTable(params)
		const patches = applying.slice(start, start + ROWS_PER_BIND)
		asStoreFailure({
			key: 'STORE_BULK_UPDATE_FAILED',
			detail,
			work: function patchInWindow() {
				window.write(function applyPatches() {
					patchRecords({ db, table, patches })
				})
			},
		})
		await commitAtCap({ params: params.params, documentId })
	}
	for (let start = 0; start < deletes.length; start += ROWS_PER_BIND) {
		const table = ownTable(params)
		const ids = deletes.slice(start, start + ROWS_PER_BIND)
		const deleted = asStoreFailure({
			key: 'STORE_DELETE_FAILED',
			detail,
			work: function deleteInWindow() {
				return window.write(function deleteIds() {
					return deleteRecords({ db, table, ids })
				})
			},
		})
		counts.set(documentId, (counts.get(documentId) ?? 0) - deleted)
		await commitAtCap({ params: params.params, documentId })
	}
}

/**
 * The session's updates checked as one list, as every store checks them (a refused one named by its
 * place among those of records the document holds), its ids looked up a bind at a time; the engine's
 * queue gets a turn each time the lookups have run for the window's time, so a write of another
 * connection does not wait for the whole check. Answers the patches checked: the ones to apply.
 */
async function checkPatchesInTurns(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	updates: RecordPatch[]
}): Promise<RecordPatch[]> {
	const { documentId, updates } = params
	const { db, windowMs } = params.params
	const held = new Set<string>()
	let since = performance.now()
	for (let start = 0; start < updates.length; start += ROWS_PER_BIND) {
		const table = ownTable(params)
		const ids = updates.slice(start, start + ROWS_PER_BIND).map((patch) => patch.recordId)
		for (const id of asReadFailure({
			detail: `The records to patch in document "${documentId}"`,
			work: function lookUpIds() {
				return readHeldIds({ db, table, ids })
			},
		}))
			held.add(id)
		if (performance.now() - since >= windowMs) {
			await yieldToQueue()
			since = performance.now()
		}
	}
	return checkHeldPatches({ patches: updates, held })
}

/**
 * The open window committed once it has written for its time, then the engine's queue gets a turn:
 * the calls of other connections run between two of the import's transactions.
 */
async function commitAtCap(params: {
	params: ImportTargetParams
	documentId: string
}): Promise<void> {
	const { documentId } = params
	const { window } = params.params
	const committed = asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail: `Records of document "${documentId}" could not be committed`,
		work: window.commitIfDue,
	})
	if (committed) await yieldToQueue()
}

/** Let the tasks waiting run (a message of another connection, a timer) before the import goes on. */
function yieldToQueue(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * One index built on the import's table in a transaction of its own (one long statement), timed as
 * `import::index`, the caller told `indexing` before and `storing` after it (the edits of other
 * connections wait while it is built, and only then); the queue gets a turn after it.
 */
async function buildIndex(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	index: RecordIndex
}): Promise<void> {
	const { state, documentId, index } = params
	const { sqlite3, db, perf, window, tellPhase, onLongStatement } = params.params
	const table = ownTable(params)
	tellPhase({ phase: 'indexing' })
	perf.start('import::index')
	try {
		asStoreFailure({
			key: 'STORE_COMMIT_FAILED',
			detail: `The ${index} index of document "${documentId}" could not be built`,
			work: function buildAlone() {
				// the build and its window's commit (the index's pages flushed in one step) told as one long statement
				onLongStatement(function buildInItsWindow() {
					window.alone(function createIndex() {
						try {
							createRecordIndex({ db, table, index })
						} catch (thrown) {
							refuseRepeatedIds({ sqlite3, db, table, documentId, thrown })
							throw thrown
						}
					})
				})
			},
		})
	} finally {
		perf.stop('import::index')
	}
	state.built.add(index)
	// the index refuses a taken id from now on
	if (index === 'id') state.givenIds = undefined
	tellPhase({ phase: 'storing' })
	await yieldToQueue()
}

/**
 * The import's last window committed and the connection durable again, then its document marked ready
 * in a durable transaction, only while its row is still this import's `importing` one.
 */
function markOwnReady(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
}): void {
	const { documentId } = params
	const { sqlite3, db, window } = params.params
	ownTable(params)
	asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail: `Records of document "${documentId}" could not be committed`,
		work: window.finish,
	})
	const marked = asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail: `Document "${documentId}" could not be marked ready`,
		work: function markInTransaction() {
			return inWriteTransaction({
				sqlite3,
				db,
				work: function markRow() {
					return markImportReady({ db, documentId })
				},
			})
		},
	})
	if (!marked) throwDocumentNotRegistered({ documentId, what: 'its ready state' })
}

/**
 * The import's progress relayed to the caller's listener (never awaited, its failure ignored): the
 * parser's progress told on and kept, so a phase is told with the bytes read so far.
 */
export function createProgressRelay(params: {
	file: File
	listener: ImportControl['onProgress']
}): ImportProgressRelay {
	const { file, listener } = params
	const last: ImportProgress = { phase: 'storing', bytesRead: 0, totalBytes: file.size }
	return {
		onProgress: function relayProgress(progress) {
			Object.assign(last, progress)
			tellListener({ listener, value: progress })
		},
		tellPhase: function tellPhase({ phase }) {
			tellListener({ listener, value: { ...last, phase } })
		},
	}
}

/**
 * A taken id refused (`STORE_DUPLICATE_ID`): looked up once the id index exists; before it, the ids
 * a file gives itself are checked against the ones stored (and kept), generated ones never repeat.
 */
function refuseIdsOfBatch(params: {
	db: Database
	table: string
	state: ImportTargetState
	documentId: string
	creates: AnyRawRecord[]
}): void {
	const { db, table, state, documentId, creates } = params
	if (state.built.has('id')) {
		refuseTakenIds({ db, table, documentId, creates })
		return
	}
	const { givenIds } = state
	if (!givenIds) return
	const ids = refuseDuplicateIds({
		documentId,
		ids: creates.map((record) => record.id),
		heldIds: givenIds,
	})
	for (const id of ids) givenIds.add(id)
}

/** The registry row of the import's document, read again (a failure of SQLite as `STORE_READ_FAILED`). */
function readRegistryRow(params: {
	db: Database
	documentId: string
}): ReturnType<typeof readDocumentState> {
	const { db, documentId } = params
	return asReadFailure({
		detail: `Document "${documentId}"`,
		work: function readState() {
			return readDocumentState({ db, documentId })
		},
	})
}
