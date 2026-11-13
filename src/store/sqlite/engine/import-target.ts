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

import { NOOP_PERF } from '@/perf'
import { checkJsonValues } from '@/store/json-values'
import { throwDocumentNotRegistered } from '@/store/store-errors'
import { tellListener } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'
import { throwIfAborted } from '@/xml/parse/parse-xml-document'

import type {
	ImportProgressRelay,
	ImportTargetParams,
	ImportTargetState,
	RecordIndex,
	RegistryRowState,
} from './engine.types'
import type { Perf } from '@/perf'
import type {
	ImportControl,
	ImportProgress,
	ImportTarget,
	WriteSessionControl,
} from '@/store/store.types'
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
			state.registered = {
				...documentTable,
				documentId: document.id,
				writeId: document.writeId,
				createdAt: document.createdAt,
			}
			params.onRegistered()
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
		/** Records of the file: creates, updates, deletes, in that order. */
		bulkWrite: async function writeImported(documentId, ops) {
			await writeOps({ params, state, documentId, ops })
		},
		/**
		 * The session's writes, the id index built first: a create reusing an id the import made is refused there as
		 * one the document holds, as every store refuses it.
		 */
		writeSession: async function writeSession(documentId, ops, control) {
			if (!state.built.has('id')) await buildIndex({ params, state, documentId, index: 'id' })
			await writeOps({ params, state, documentId, ops, onWritten: writtenTally({ ops, control }) })
		},
		/**
		 * The document ready, once its table has every index. A document removed meanwhile is refused
		 * `DOCUMENT_NOT_REGISTERED`, never marked.
		 */
		markReady: async function markReady(documentId) {
			for (const index of Object.keys(RECORD_INDEXES) as RecordIndex[]) {
				if (!state.built.has(index)) await buildIndex({ params, state, documentId, index })
			}
			markOwnReady({ params, state, documentId })
		},
		/**
		 * What a failed or aborted import leaves goes: its own row only, never a document registered
		 * since under the same id (which may have taken its number again).
		 */
		removeDocument: async function removeImported(documentId) {
			const { registered } = state
			// nothing to remove on a closed engine: no import outlives it, the next start sweeps
			if (registered?.documentId !== documentId || !db.isOpen()) return
			endQuietly({ window: params.window })
			const row = readRegistryRow({ db, documentId })
			if (!isOwnRow({ row, registered, documentId })) return
			await removeDocument({ documentId })
		},
	}
}

/**
 * How far the session's writes are, told to `control.onProgress` after each bind: the writes handed so far (a patch
 * of a record the document no longer holds counted as written), out of all of them.
 */
function writtenTally(params: {
	ops: Parameters<ImportTarget['writeSession']>[1]
	control: WriteSessionControl | undefined
}): (count: number) => void {
	const { ops, control } = params
	const total = (ops.creates?.length ?? 0) + (ops.updates?.length ?? 0) + (ops.deletes?.length ?? 0)
	let done = 0
	return function tellWritten(count) {
		done += count
		control?.onProgress?.({ done, total })
	}
}

/**
 * Creates, updates, deletes, in that order; the id index built before the first update or delete. `onWritten` told
 * the writes handed after each bind (the session's writes tell their progress).
 */
async function writeOps(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	ops: Parameters<ImportTarget['bulkWrite']>[1]
	onWritten?: (count: number) => void
}): Promise<void> {
	const { state, documentId, ops, onWritten } = params
	const { creates = [], updates = [], deletes = [] } = ops
	if (creates.length > 0) {
		await writeCreates({ params: params.params, state, documentId, creates, onWritten })
	}
	if (updates.length === 0 && deletes.length === 0) return
	if (!state.built.has('id')) {
		await buildIndex({ params: params.params, state, documentId, index: 'id' })
	}
	await writeChanges({ params: params.params, state, documentId, updates, deletes, onWritten })
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
	if (!registered || !isOwnRow({ row, registered, documentId })) {
		throwDocumentNotRegistered({ documentId, what: 'records' })
	}
	return registered.table
}

/**
 * Whether the row is still the one this import registered, `importing`: its number, its write and its creation
 * time - a document removed meanwhile frees its number, which the next registration may take.
 */
function isOwnRow(params: {
	row: RegistryRowState | undefined
	registered: ImportTargetState['registered']
	documentId: string
}): boolean {
	const { row, registered, documentId } = params
	if (!row || !registered || registered.documentId !== documentId) return false
	return (
		row.status === 'importing' &&
		row.seq === registered.seq &&
		row.writeId === registered.writeId &&
		row.createdAt === registered.createdAt
	)
}

/**
 * Records into the import's windows: the whole set checked first, in every store's order - a value
 * that is not JSON, then an id taken (looked up once the id index exists, as it does for the session's
 * writes; before it, the ids a file gives itself against the ones stored; the ids the import makes are
 * new) - then stored a bind at a time, the window's time checked after each (the session's creates
 * may be many).
 */
async function writeCreates(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	creates: AnyRawRecord[]
	onWritten?: (count: number) => void
}): Promise<void> {
	const { state, documentId, creates, onWritten } = params
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
		onWritten?.(records.length)
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
	onWritten?: (count: number) => void
}): Promise<void> {
	const { documentId, updates, deletes, onWritten } = params
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
		onWritten?.(patches.length)
		await commitAtCap({ params: params.params, documentId })
	}
	// the patches of records the document no longer holds are handed, never applied: counted as written
	if (applying.length < updates.length) onWritten?.(updates.length - applying.length)
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
		onWritten?.(ids.length)
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
			await yieldToTimers()
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
	if (committed) await yieldToTimers()
}

/** Let the tasks waiting run (a message of another connection, a timer) before the import goes on. */
function yieldToTimers(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * One index built on the import's table in a transaction of its own (one long statement), timed as
 * `import::index`, the caller told `indexing` before and the phase it was in after it (the edits of other
 * connections wait while it is built, and only then); the queue gets a turn after it.
 */
async function buildIndex(params: {
	params: ImportTargetParams
	state: ImportTargetState
	documentId: string
	index: RecordIndex
}): Promise<void> {
	const { state, documentId, index } = params
	const { sqlite3, db, perf, window, tellIndexing, tellIndexBuilt, onLongStatement } = params.params
	const table = ownTable(params)
	tellIndexing({ index })
	perf.start('import::index')
	try {
		asStoreFailure({
			key: 'STORE_COMMIT_FAILED',
			detail: `The ${index} index of document "${documentId}" could not be built`,
			work: function buildAlone() {
				// the build and its window's commit (the index's pages flushed in one step) told as one long statement
				onLongStatement({
					work: function buildInItsWindow() {
						window.alone(function createIndex() {
							try {
								createRecordIndex({ db, table, index })
							} catch (thrown) {
								refuseRepeatedIds({ sqlite3, db, table, documentId, thrown })
								throw thrown
							}
						})
					},
				})
			},
		})
	} finally {
		perf.stop('import::index')
		perf.stop('import::phase.indexing')
	}
	state.built.add(index)
	// the index refuses a taken id from now on
	if (index === 'id') state.givenIds = undefined
	tellIndexBuilt()
	await yieldToTimers()
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
 * The import's progress relayed to the caller's listener (never awaited, its failure reported once for the import):
 * the import's progress told on and kept, so an index build is told with the bytes read so far and, once built, the
 * phase the import was in is told again; each build timed as `import::phase.indexing` (opened here, closed by the
 * build whether it succeeds or not).
 */
export function createProgressRelay(params: {
	file: File
	listener: ImportControl['onProgress']
	perf?: Perf
}): ImportProgressRelay {
	const { file, listener, perf = NOOP_PERF } = params
	// the import's reports: a listener failing at each one reported once
	const call = {}
	let last: ImportProgress = { phase: 'storing', bytesRead: 0, totalBytes: file.size }
	return {
		onProgress: function relayProgress(progress) {
			last = progress
			tellListener({ listener, value: progress, of: TOLD_OF.importProgress, call })
		},
		tellIndexing: function tellIndexing({ index }) {
			perf.start('import::phase.indexing')
			const { bytesRead, totalBytes } = last
			tellListener({
				listener,
				value: { phase: 'indexing', index, bytesRead, totalBytes },
				of: TOLD_OF.importProgress,
				call,
			})
		},
		tellIndexBuilt: function tellIndexBuilt() {
			tellListener({ listener, value: last, of: TOLD_OF.importProgress, call })
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
