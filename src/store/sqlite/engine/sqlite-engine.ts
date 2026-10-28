import { yieldToMessages } from '../../engine/message-turn'
import {
	deleteBlob,
	readBlob,
	readBlobEntries,
	readBlobEntry,
	writeBlob,
	writeBlobEntry,
} from './blobs'
import { encodeCheckedRecords, insertEncodedRows } from './bulk-insert'
import { commitRecords, stepHistory } from './commit'
import { deviceCacheMiB, reportedDeviceMemoryGiB } from './device-cache'
import { asReadFailure, asStoreFailure, sqliteCodeOf, toStoreFailure } from './engine-errors'
import { DEFAULT_ENGINE_OPTIONS, IMPORT_SPACE_FACTOR } from './engine.constants'
import { hasCommitOf, readChangeLog, readHistoryStatus } from './history'
import { createImportQueue } from './import-queue'
import { createImportTarget, createProgressRelay } from './import-target'
import { createImportWindow, endQuietly } from './import-window'
import { reclaimInSteps } from './reclaim'
import {
	checkApplyingPatches,
	countRecords,
	deleteRecords,
	patchRecords,
	prepareReadsById,
	readAllRecords,
	readRecord,
	readRecordsById,
	readRecordsByTag,
	refuseTakenIds,
} from './records'
import {
	deleteDocument,
	deleteUnfinishedImports,
	documentTablesOf,
	insertDocument,
	readDocument,
	readDocumentState,
	readDocuments,
	readDocumentsByWriteId,
	recordTableOf,
	updateDocumentRow,
} from './registry'
import { createRecordIndexes, prepareFile } from './schema'
import { inWriteTransaction } from './transaction'

import { createDialecteError, throwDialecteError } from '@/errors'
import { createPerf } from '@/perf'
import { runExport, throwIfExportAborted } from '@/project/io/run-export'
import { runImport } from '@/project/io/run-import'
import { requireStoreRuntime } from '@/project/io/store-runtime'
import { tellCommitProgress } from '@/store/commit-progress'
import { checkJsonValues } from '@/store/json-values'
import { throwDocumentNotRegistered, throwStoreClosed } from '@/store/store-errors'
import { writeOutcomeOf } from '@/store/write-outcome'
import { invariant } from '@/utils'
import { throwIfAborted } from '@/xml/parse/parse-xml-document'

import type { EngineBlobMembers, EngineMembers } from '../../engine/engine.types'
import type {
	EncodedRows,
	ExportReads,
	HistoryDirection,
	OpenSqliteEngineParams,
	RecordReadsById,
	RunningExport,
	RunningImport,
	SqliteEngine,
	SqliteEngineExportParams,
	SqliteEngineImportParams,
} from './engine.types'
import type {
	ExportControl,
	ExportFileResult,
	ExportSource,
	ImportControl,
	ImportFileResult,
} from '@/store/store.types'
import type { AnyRawRecord, BlobRecord, RecordPatch } from '@/types'
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Start the engine of a project on its database: a new file is laid out, a file of another layout
 * refused (`PROJECT_LAYOUT_OUTDATED`), every document an import left `importing` removed - its free
 * pages given back in steps while the engine already serves. The engine owns the database from then
 * on: a start that fails closes it, so the file stays free.
 *
 * Its methods run synchronously on the one connection and never await while a transaction is open,
 * so no call runs inside another's transaction. A failure of SQLite is thrown as the operation's
 * store error (`STORE_READ_FAILED`, `STORE_COMMIT_FAILED`, ...), the failure as its cause; a refusal
 * passes as it is.
 */
export function openSqliteEngine(params: OpenSqliteEngineParams): SqliteEngine {
	const { sqlite3, db, dialecteId, name, runtime, ensureImportSpace, onWork } = params
	const onLongStatement = params.onLongStatement ?? runStatement
	const { explainIoFailure } = params
	const engineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...params.options }
	const deviceMiB = deviceCacheMiB({
		deviceMemoryGiB: reportedDeviceMemoryGiB(),
		rule: engineOptions.cacheRule,
	})
	const steadyCacheMiB = engineOptions.steadyCacheMiB ?? deviceMiB
	/** An import runs with the device's cache, never below the steady one. */
	const importCacheMiB = Math.max(deviceMiB, steadyCacheMiB)
	try {
		asStoreFailure({
			key: 'STORE_CONNECTION_FAILED',
			detail: 'The project file could not be opened',
			work: function startOnFile() {
				prepareFile({ sqlite3, db, dialecteId, steadyCacheMiB })
				// at the start no client waits on the engine yet (the open has its own budget): nobody to tell
				inWriteTransaction({
					sqlite3,
					db,
					work: function sweepUnfinishedImports() {
						deleteUnfinishedImports({ db })
					},
				})
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
	/**
	 * How many writes each document has taken since the engine started (an export never outlives it);
	 * kept for a removed document, so one registered again under its id goes on from it.
	 */
	const versions = new Map<string, number>()
	/** The exports running, by the caller's id: each one's abort and the statement it reads through. */
	const exports = new Map<string, RunningExport>()
	/** How many removals the engine ran: a statement prepared on a document's table before one is prepared again. */
	const removals = { count: 0 }
	const queue = createImportQueue()
	/** The window of the import that runs: every other write settles it first. */
	const importing: RunningImport = { window: undefined }
	/** Set by `close()`: every call refused from then on, an import resumed after it aborted first. */
	const state = { closed: false }

	const blobMembers: EngineBlobMembers = {
		/**
		 * Refused, nothing written, in the order every store answers in: an owner document not
		 * registered, then an entry that is not JSON. The bytes are read first, before any statement.
		 */
		addBlob: async function addBlob(entry, data) {
			refuseClosed({ state, name })
			const bytes = new Uint8Array(await data.arrayBuffer())
			refuseClosed({ state, name })
			const owner = asReadFailure({
				detail: `Document "${entry.documentId}"`,
				work: function readOwner() {
					return readDocument({ db, documentId: entry.documentId })
				},
			})
			if (!owner) throwDocumentNotRegistered({ documentId: entry.documentId, what: 'a blob' })
			checkJsonValues({ value: entry })
			writeInTransaction({
				detail: `Blob "${entry.id}" could not be added`,
				work: function writeEntryAndBytes() {
					writeBlob({ db, entry, type: data.type, bytes })
				},
			})
		},
		getBlob: async function getBlob(blobId) {
			refuseClosed({ state, name })
			const blob = asReadFailure({
				detail: `Blob "${blobId}"`,
				work: function readEntryAndBytes() {
					return readBlob({ db, blobId })
				},
			})
			if (!blob) return undefined
			return { entry: blob.entry, data: new Blob([blob.bytes.slice()], { type: blob.type }) }
		},
		getBlobsByDocument: async function getBlobsByDocument(documentId) {
			refuseClosed({ state, name })
			return readEntries({ filter: { documentId } })
		},
		getBlobsByRecord: async function getBlobsByRecord(documentId, recordRef) {
			refuseClosed({ state, name })
			return readEntries({ filter: { documentId, recordRef } })
		},
		getStandaloneBlobs: async function getStandaloneBlobs() {
			refuseClosed({ state, name })
			return readEntries({ filter: 'standalone' })
		},
		/** An unknown blob is refused first, then a reference that is not JSON; an identical reference is kept once. */
		attachBlob: async function attachBlob(blobId, ref) {
			refuseClosed({ state, name })
			const entry = blobEntryOf({ blobId })
			checkJsonValues({ value: ref })
			const held = entry.attachedTo.some(
				(attached) =>
					attached.documentId === ref.documentId &&
					attached.recordRef === ref.recordRef &&
					attached.attribute === ref.attribute,
			)
			if (held) return
			writeInTransaction({
				detail: `Blob "${blobId}" could not be attached`,
				work: function writeAttached() {
					writeBlobEntry({ db, entry: { ...entry, attachedTo: [...entry.attachedTo, ref] } })
				},
			})
		},
		/** An unknown blob is refused; every reference to that record of that document is dropped. */
		detachBlob: async function detachBlob(blobId, ref) {
			refuseClosed({ state, name })
			const entry = blobEntryOf({ blobId })
			const attachedTo = entry.attachedTo.filter(
				(attached) =>
					!(attached.documentId === ref.documentId && attached.recordRef === ref.recordRef),
			)
			writeInTransaction({
				detail: `Blob "${blobId}" could not be detached`,
				work: function writeDetached() {
					writeBlobEntry({ db, entry: { ...entry, attachedTo } })
				},
			})
		},
		/** An unknown blob is ignored. */
		removeBlob: async function removeBlob(blobId) {
			refuseClosed({ state, name })
			const entry = asReadFailure({
				detail: `Blob "${blobId}"`,
				work: function readEntry() {
					return readBlobEntry({ db, blobId })
				},
			})
			if (!entry) return
			writeInTransaction({
				detail: `Blob "${blobId}" could not be removed`,
				work: function deleteEntryAndBytes() {
					deleteBlob({ db, blobId })
				},
			})
		},
	}

	const members: EngineMembers = {
		...blobMembers,
		registerDocument: async function registerDocument(document) {
			refuseClosed({ state, name })
			asStoreFailure({
				key: 'STORE_COMMIT_FAILED',
				detail: `Document "${document.id}" could not be registered`,
				work: function registerInTransaction() {
					settleImport({ importing })
					inWriteTransaction({
						sqlite3,
						db,
						work: function insertRow() {
							const { table } = insertDocument({ db, document })
							createRecordIndexes({ db, table })
						},
					})
				},
			})
			counts.set(document.id, 0)
		},
		getDocument: async function getDocument(documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `Document "${documentId}"`,
				work: function readOneDocument() {
					return readDocument({ db, documentId })
				},
			})
		},
		getDocuments: async function getDocuments() {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: 'The documents',
				work: function readAllDocuments() {
					return readDocuments({ db })
				},
			})
		},
		updateDocument: async function updateDocument(documentId, updates) {
			refuseClosed({ state, name })
			asStoreFailure({
				key: 'STORE_COMMIT_FAILED',
				detail: `Document "${documentId}" could not be updated`,
				work: function updateInTransaction() {
					settleImport({ importing })
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
			refuseClosed({ state, name })
			await removeDocumentFromFile({ documentId })
		},
		get: async function get(id, documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `Record "${id}" of document "${documentId}"`,
				work: function readOne() {
					const table = recordTableOf({ db, documentId })
					return table ? readRecord({ db, table, id }) : undefined
				},
			})
		},
		getByDocumentId: async function getByDocumentId(documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `The records of document "${documentId}"`,
				work: function readAll() {
					const table = recordTableOf({ db, documentId })
					return table ? readAllRecords({ db, table }) : []
				},
			})
		},
		count: async function count(documentId) {
			refuseClosed({ state, name })
			const held = counts.get(documentId)
			if (held !== undefined) return held
			return asReadFailure({
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
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `The ${tagName} records of document "${documentId}"`,
				work: function readByTag() {
					const table = recordTableOf({ db, documentId })
					return table ? readRecordsByTag({ db, table, tagName }) : []
				},
			})
		},
		getMany: async function getMany(ids, documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
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
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `The outcome of write "${writeId}"`,
				work: function outcomeFromRegistry() {
					// waiting its turn, an import has no row yet; once it runs, its row says
					if (queue.waits({ writeId })) return 'running'
					const documents = readDocumentsByWriteId({ db, writeId })
					return writeOutcomeOf({ documents, writeId, committed: hasCommitOf({ db, writeId }) })
				},
			})
		},
		/**
		 * Refused whole, in the order every store answers in: a document not registered, a create that
		 * is not JSON, a taken id; then, in the transaction, a patch that is not JSON.
		 */
		bulkWrite: async function bulkWrite(documentId, ops) {
			refuseClosed({ state, name })
			const { creates = [], updates = [], deletes = [] } = ops
			const deleted = writeRecords({
				sqlite3,
				db,
				documentId,
				creates,
				updates,
				deletes,
				importing,
			})
			noteWrite({ documentId, gained: creates.length - deleted })
		},
		/**
		 * Refused whole, nothing written and no history entry kept, in the order every store answers in;
		 * the progress is told once the commit is written, part by part.
		 */
		commit: async function commit(params, onProgress) {
			refuseClosed({ state, name })
			const { documentId, creates, updates, deletes } = params
			const gained = await writing(function commitInOneTransaction() {
				return commitRecords({
					...params,
					sqlite3,
					db,
					settle: function settleBeforeCommit() {
						settleImport({ importing })
					},
				})
			})
			noteWrite({ documentId, gained })
			tellCommitProgress({ onProgress, parts: [creates.length, updates.length, deletes.length] })
		},
		undo: async function undo(documentId) {
			refuseClosed({ state, name })
			stepDocumentHistory({ documentId, direction: 'back' })
		},
		redo: async function redo(documentId) {
			refuseClosed({ state, name })
			stepDocumentHistory({ documentId, direction: 'forward' })
		},
		getHistoryStatus: async function getHistoryStatus(documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `The history of document "${documentId}"`,
				work: function readStatus() {
					return readHistoryStatus({ db, documentId })
				},
			})
		},
		getChangeLog: async function getChangeLog(documentId) {
			refuseClosed({ state, name })
			return asReadFailure({
				detail: `The changelog of document "${documentId}"`,
				work: function readEntries() {
					const tables = documentTablesOf({ db, documentId })
					return tables ? readChangeLog({ db, documentId, table: tables.history }) : []
				},
			})
		},
	}

	/** The entry of a blob the store holds; an unknown one is refused `STORE_BLOB_NOT_FOUND`. */
	function blobEntryOf(params: { blobId: string }): BlobRecord {
		const { blobId } = params
		const entry = asReadFailure({
			detail: `Blob "${blobId}"`,
			work: function readEntry() {
				return readBlobEntry({ db, blobId })
			},
		})
		if (!entry) throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		return entry
	}

	function readEntries(params: {
		filter: { documentId: string; recordRef?: string } | 'standalone'
	}): BlobRecord[] {
		return asReadFailure({
			detail: 'The blobs',
			work: function readFiltered() {
				return readBlobEntries({ db, filter: params.filter })
			},
		})
	}

	/**
	 * A document gone with all it has (its records, its history, the blobs it owns) in one transaction,
	 * then its pages given back to the file in steps, the calls waiting served between them. A failure
	 * of the reclaim is reported as a failed removal of a document that is gone; removing it again is
	 * harmless (an unknown id is ignored, the free pages reclaimed then).
	 */
	async function removeDocumentFromFile(params: { documentId: string }): Promise<void> {
		const { documentId } = params
		const detail = `Document "${documentId}" could not be removed`
		try {
			asStoreFailure({
				key: 'STORE_DELETE_FAILED',
				detail,
				work: function dropInTransaction() {
					settleImport({ importing })
					onLongStatement(function dropInOneTransaction() {
						inWriteTransaction({
							sqlite3,
							db,
							work: function deleteRowAndTable() {
								deleteDocument({ db, documentId })
							},
						})
					})
					counts.delete(documentId)
				},
			})
		} finally {
			// a table may be gone: what reads it through a statement of its own prepares it again, and an
			// export of the id - which may be registered and imported again - starts again
			removals.count += 1
			versions.set(documentId, (versions.get(documentId) ?? 0) + 1)
		}
		try {
			await reclaimFreePagesInSteps()
		} catch (thrown) {
			throw toStoreFailure({ key: 'STORE_DELETE_FAILED', detail, thrown })
		}
	}

	/** The file's free pages given back in steps; stopped once the engine is closed. */
	function reclaimFreePagesInSteps(): Promise<void> {
		return reclaimInSteps({
			db,
			settle: function settleBeforeStep() {
				settleImport({ importing })
			},
			isClosed: function isEngineClosed() {
				return state.closed
			},
			pagesPerStatement: engineOptions.reclaimPagesPerStatement,
			sliceMs: engineOptions.reclaimSliceMs,
			onStep: onWork,
		})
	}

	/** A write of the engine's own in one durable transaction, once the import that runs is settled. */
	function writeInTransaction(params: { detail: string; work: () => void }): void {
		const { detail, work } = params
		asStoreFailure({
			key: 'STORE_COMMIT_FAILED',
			detail,
			work: function writeSettled() {
				settleImport({ importing })
				inWriteTransaction({ sqlite3, db, work })
			},
		})
	}

	/**
	 * A write landed on the document (a bulk write, a commit, an undo, a redo): its count kept in step
	 * when the engine holds it, its version moved on - an export reading it starts again.
	 */
	function noteWrite(params: { documentId: string; gained: number }): void {
		const { documentId, gained } = params
		const held = counts.get(documentId)
		if (held !== undefined) counts.set(documentId, held + gained)
		versions.set(documentId, (versions.get(documentId) ?? 0) + 1)
	}

	/**
	 * What an export reads through: the engine's own reads, refused `EXPORT_ABORTED` once the export
	 * is aborted (a `close()` aborts it), and the document's version - `undefined` unless it is ready.
	 */
	function exportSourceOf(params: {
		signal: AbortSignal
		documentId: string
		reads: ExportReads
	}): ExportSource {
		const { signal, documentId, reads } = params
		function refuseAborted(): void {
			throwIfExportAborted({ signal, documentId })
		}
		return {
			getDocument: async function getDocument(id) {
				refuseAborted()
				return members.getDocument(id)
			},
			count: async function count(id) {
				refuseAborted()
				return members.count(id)
			},
			/** Through one statement on the document's table, prepared again after any removal. */
			getMany: async function getMany(ids, id) {
				refuseAborted()
				refuseClosed({ state, name })
				return asReadFailure({
					detail: `Records of document "${id}"`,
					work: function readManyPrepared() {
						const records = readsOf({ reads, documentId: id })?.read(ids)
						return ids.map((recordId) => records?.get(recordId))
					},
				})
			},
			getByTagNameInDocument: async function getByTagNameInDocument(tagName, id) {
				refuseAborted()
				return members.getByTagNameInDocument(tagName, id)
			},
			getExportVersion: async function getExportVersion({ documentId: id }) {
				refuseAborted()
				refuseClosed({ state, name })
				const document = asReadFailure({
					detail: `Document "${id}"`,
					work: function readState() {
						return readDocumentState({ db, documentId: id })
					},
				})
				if (document?.status !== 'ready') return undefined
				return versions.get(id) ?? 0
			},
		}
	}

	/** An undo or a redo; nothing to do at either end of the history, nor for a document not registered. */
	function stepDocumentHistory(params: { documentId: string; direction: HistoryDirection }): void {
		const { documentId, direction } = params
		const gained = stepHistory({
			sqlite3,
			db,
			documentId,
			direction,
			settle: function settleBeforeStep() {
				settleImport({ importing })
			},
		})
		if (gained === undefined) return
		noteWrite({ documentId, gained })
	}

	/**
	 * A write that failed because the file can grow no more answers `STORE_QUOTA_EXCEEDED` (SQLite's
	 * `SQLITE_FULL`, or an I/O error the file system explains so); any other failure stays as it is.
	 */
	async function outOfSpaceOr(params: { thrown: unknown }): Promise<unknown> {
		const { thrown } = params
		const code = sqliteCodeOf({ thrown })
		if (code === sqlite3.capi.SQLITE_FULL) {
			return createDialecteError('STORE_QUOTA_EXCEEDED', {
				detail: `The file of project "${name}" can grow no more`,
				meta: { project: name },
				cause: thrown instanceof Error ? thrown : undefined,
			})
		}
		if (code === sqlite3.capi.SQLITE_IOERR && explainIoFailure) {
			return (await explainIoFailure({ thrown })) ?? thrown
		}
		return thrown
	}

	/** A commit, its failure for want of space answered `STORE_QUOTA_EXCEEDED`. */
	async function writing<GenericResult>(work: () => GenericResult): Promise<GenericResult> {
		try {
			return work()
		} catch (thrown) {
			throw await outOfSpaceOr({ thrown })
		}
	}

	/** The import runs here, next to the data, in its turn; it writes through the engine's own members. */
	async function importAsOwner(
		importParams: SqliteEngineImportParams,
		onProgress?: ImportControl['onProgress'],
	): Promise<ImportFileResult> {
		refuseClosed({ state, name })
		// a store with no dialecte refuses at once, before any import's turn, as every store does
		const importRuntime = requireStoreRuntime({ runtime, storeName: name, operation: 'import' })
		const { file, options, writeId, clientId } = importParams
		return queue.run({
			writeId,
			clientId,
			work: async function importInTurn(signal) {
				// a waiting import aborted gets its turn at once: refused before it takes any part of the engine
				throwIfAborted({ signal, file })
				if (ensureImportSpace) {
					await ensureImportSpace({ bytes: importSpaceOf({ db, file }) })
					throwIfAborted({ signal, file })
				}
				const perf = createPerf({ enabled: importRuntime.perf ?? false, timeline: false })
				const window = createImportWindow({
					sqlite3,
					db,
					perf,
					windowMs: engineOptions.importWindowMs,
					importCacheMiB,
					steadyCacheMiB,
				})
				const progress = createProgressRelay({
					file,
					listener: function tellWorkDone(told) {
						onWork?.()
						// its answer handed on: the relay drops a rejection, never leaves it unhandled
						return onProgress?.(told)
					},
				})
				const target = createImportTarget({
					sqlite3,
					db,
					perf,
					signal,
					file,
					counts,
					removeDocument: function removeFailedImport({ documentId }) {
						return removeDocumentFromFile({ documentId })
					},
					window,
					windowMs: engineOptions.importWindowMs,
					tellPhase: progress.tellPhase,
					onLongStatement,
					customIds: options?.useCustomRecordsIds ?? false,
				})
				importing.window = window
				try {
					const result = await runImport(
						{ store: target, runtime: importRuntime, file, options, writeId, perf },
						{ onProgress: progress.onProgress, signal },
					)
					asStoreFailure({
						key: 'STORE_COMMIT_FAILED',
						detail: `The import of "${file.name}" could not end`,
						work: window.end,
					})
					return result
				} catch (failure) {
					endQuietly({ window })
					throw await outOfSpaceOr({ thrown: failure })
				} finally {
					importing.window = undefined
				}
			},
		})
	}

	async function abortImport(params: { writeId: string }): Promise<void> {
		queue.abort(params)
	}

	/** The export runs here, next to the data; a write on its document meanwhile restarts it once. */
	async function exportFile(
		exportParams: SqliteEngineExportParams,
		onProgress?: ExportControl['onProgress'],
	): Promise<ExportFileResult> {
		refuseClosed({ state, name })
		const exportRuntime = requireStoreRuntime({ runtime, storeName: name, operation: 'export' })
		const { documentId, options, exportId, clientId } = exportParams
		// one export per id: a second would take the first one's abort and statement from the engine
		invariant(!exports.has(exportId), {
			detail: `An export of id "${exportId}" runs already: give each export an id of its own`,
		})
		const controller = new AbortController()
		const reads: ExportReads = { current: undefined }
		exports.set(exportId, { clientId, controller, reads })
		try {
			// the calls sent before it are served first: an abort its caller sent right after it lands
			await yieldToMessages()
			return await runExport(
				{
					source: exportSourceOf({ signal: controller.signal, documentId, reads }),
					runtime: exportRuntime,
					documentId,
					options,
				},
				{
					onProgress: function tellWorkDone(told) {
						onWork?.()
						// its answer handed on: the relay drops a rejection, never leaves it unhandled
						return onProgress?.(told)
					},
					signal: controller.signal,
				},
			)
		} finally {
			exports.delete(exportId)
			// a close() has finalized it already: the connection cannot close while a statement lives
			if (db.isOpen()) finalizeReads({ reads })
		}
	}

	/**
	 * The export's reads by id on the document's table: prepared once, again after a removal (a table
	 * may have gone, or another document taken its number); none while the document is not registered.
	 */
	function readsOf(params: {
		reads: ExportReads
		documentId: string
	}): RecordReadsById | undefined {
		const { reads, documentId } = params
		const held = reads.current
		if (held && held.documentId === documentId && held.removals === removals.count)
			return held.statement
		held?.statement.finalize()
		reads.current = undefined
		const table = recordTableOf({ db, documentId })
		if (!table) return undefined
		reads.current = {
			documentId,
			removals: removals.count,
			statement: prepareReadsById({ db, table }),
		}
		return reads.current.statement
	}

	async function abortExport(params: { exportId: string }): Promise<void> {
		exports.get(params.exportId)?.controller.abort()
	}

	// what the unfinished imports left is given back while the engine serves: a large one held a start for seconds
	reclaimFreePagesInSteps().catch(leaveForNextReclaim)

	return {
		...members,
		importFile: importAsOwner,
		abortImport,
		exportFile,
		abortExport,
		abortExportsOf: function abortExportsOf({ clientId }) {
			for (const running of exports.values()) {
				if (running.clientId === clientId) running.controller.abort()
			}
		},
		abortImportsOf: function abortImportsOf(params) {
			queue.abortOwnedBy(params)
		},
		clientView: function clientView({ clientId }) {
			return {
				...members,
				importFile: function importAsClient(importParams, clientProgress) {
					return importAsOwner({ ...importParams, clientId }, clientProgress)
				},
				abortImport,
				exportFile: function exportAsClient(exportParams, clientProgress) {
					return exportFile({ ...exportParams, clientId }, clientProgress)
				},
				abortExport,
			}
		},
		close: function closeEngine() {
			state.closed = true
			queue.abortAll()
			// every statement finalized before the connection closes: one left open keeps the file held
			for (const { controller, reads } of exports.values()) {
				controller.abort()
				finalizeReads({ reads })
			}
			db.close()
		},
	}
}

/**
 * A start's reclaim that failed is left: nothing waits for it, and the next removal or start gives the
 * free pages back.
 */
function leaveForNextReclaim(): void {}

/** What an import of `file` needs free: about twice its size, less the pages the file has free already. */
function importSpaceOf(params: { db: Database; file: File }): number {
	const { db, file } = params
	const freeBytes =
		Number(db.selectValue('PRAGMA freelist_count')) * Number(db.selectValue('PRAGMA page_size'))
	return Math.max(0, IMPORT_SPACE_FACTOR * file.size - freeBytes)
}

/** The import that runs, if any, committed and made durable before another write: that write stands on its own. */
function settleImport(params: { importing: RunningImport }): void {
	params.importing.window?.settle()
}

/** The statement an export reads through, finalized; none held after. */
function finalizeReads(params: { reads: ExportReads }): void {
	const { reads } = params
	reads.current?.statement.finalize()
	reads.current = undefined
}

/** A call on a closed engine: `STORE_CLOSED`, never a failure of the closed database. */
function refuseClosed(params: { state: { closed: boolean }; name: string }): void {
	if (params.state.closed) throwStoreClosed({ storeName: params.name })
}

/** A bulk write in one transaction; answers how many records it deleted. */
function writeRecords(params: {
	sqlite3: Sqlite3Static
	db: Database
	documentId: string
	creates: AnyRawRecord[]
	updates: RecordPatch[]
	deletes: string[]
	importing: RunningImport
}): number {
	const { sqlite3, db, documentId, creates, updates, deletes, importing } = params
	const detail = `Records of document "${documentId}" could not be written`
	const table = asReadFailure({
		detail: `Document "${documentId}"`,
		work: function findTable() {
			return recordTableOf({ db, documentId })
		},
	})
	if (!table) throwDocumentNotRegistered({ documentId, what: 'records' })
	const rows = encodeCheckedRecords({ records: creates })
	asReadFailure({
		detail: `The ids of document "${documentId}"`,
		work: function checkIds() {
			refuseTakenIds({ db, table, documentId, creates })
		},
	})
	return asStoreFailure({
		key: 'STORE_COMMIT_FAILED',
		detail,
		work: function writeInTransaction() {
			settleImport({ importing })
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
			checkApplyingPatches({ db, table, patches: updates })
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

/** A long statement with no one to tell: run as it is. */
function runStatement<GenericResult>(work: () => GenericResult): GenericResult {
	return work()
}
