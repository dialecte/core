import { createRunningOperations } from '../running-operations'
import { throwStoreClosed } from '../store-errors'

import { throwIfExportAborted } from '@/project/io/run-export'

import type {
	ChangeLogEntry,
	ExportFileParams,
	ExportFileResult,
	ImportFileParams,
	ImportFileResult,
	Store,
	WriteOutcome,
} from '../store.types'
import type { EngineConnector, EngineLink, EngineStoreParams } from './engine-store.types'
import type { EngineApi } from './engine.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

/**
 * EngineStore - the store port over a project's engine (the SQLite one today), reached through a link: the engine
 * holds the data and answers every connection of the project alike (one state per name). This
 * adapter keeps what is per connection: `close()` refuses the operations started after it with
 * `STORE_CLOSED` and releases the link once the running ones complete; `open()` connects again.
 */
export class EngineStore implements Store {
	readonly name: string
	private readonly connector: EngineConnector
	private link: EngineLink | undefined
	private connecting: Promise<EngineLink> | undefined
	/** Set by `close()`, cleared by `open()`: a closed store refuses every operation started after it. */
	private closed = false
	/** How many times `close()` was called: an `open()` refuses when one came after it was called. */
	private closings = 0
	/** The operations running: `close()` releases the link, `open()` and `destroy()` go on, once none is left. */
	private readonly operations = createRunningOperations()

	constructor(params: EngineStoreParams) {
		this.name = params.name
		this.connector = params.connector
	}

	// --- Lifecycle ---

	/** Connect to the project's engine (started when none runs: a file of another layout is refused there). */
	async open(): Promise<void> {
		const closingsAtCall = this.closings
		// an operation still running keeps the link: the store opens once it is done
		await this.operations.whenIdle()
		// a close() called after this open() wins: the store stays closed
		if (this.closings !== closingsAtCall) throwStoreClosed({ storeName: this.name })
		this.closed = false
		await this.tracked(async () => {
			await this.currentEngine()
		})
	}

	/** Refuse every operation started from now on until opened again; the link goes once the running ones end. */
	close(): void {
		this.closed = true
		this.closings += 1
		if (this.operations.count === 0) this.releaseLink()
	}

	/** Delete the project, once the operations running complete: every store of the name then reads empty. */
	async destroy(): Promise<void> {
		await this.operations.whenIdle()
		this.releaseLink()
		await this.connector.destroy()
	}

	// --- Cross-realm reconciliation ---

	/** Nothing to bring in sync: the engine answers every connection from one state. */
	async reconcile(): Promise<void> {
		return this.operation(async () => undefined)
	}

	/** A document is readable once registered, as on every store. */
	async isDocumentReadable(documentId: string): Promise<boolean> {
		return this.operation(async (engine) => {
			const document = await engine.getDocument(documentId)
			return document !== undefined
		})
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		return this.operation((engine) => engine.registerDocument(file))
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.operation((engine) => engine.getDocument(documentId))
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.operation((engine) => engine.getDocuments())
	}

	async updateDocument(documentId: string, updates: DocumentUpdates): Promise<void> {
		return this.operation((engine) => engine.updateDocument(documentId, updates))
	}

	async removeDocument(documentId: string): Promise<void> {
		return this.operation((engine) => engine.removeDocument(documentId))
	}

	// --- Record access ---

	async get(id: string, documentId: string): Promise<AnyRawRecord | undefined> {
		return this.operation((engine) => engine.get(id, documentId))
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return this.operation((engine) => engine.getByDocumentId(documentId))
	}

	async count(documentId: string): Promise<number> {
		return this.operation((engine) => engine.count(documentId))
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		return this.operation((engine) => engine.getByTagNameInDocument(tagName, documentId))
	}

	async getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]> {
		return this.operation((engine) => engine.getMany(ids, documentId))
	}

	// --- Import ---

	/**
	 * The import runs in the engine; its progress listener stays here (the engine's ticks come back on
	 * the call's port, before its answer) and its abort crosses as a call of its own, by `writeId`: made only once the import was asked for, so the engine
	 * knows it (a signal already aborted is told at once), and the engine answers in every store's
	 * order (a store with no dialecte refuses first).
	 */
	async importFile(params: ImportFileParams): Promise<ImportFileResult> {
		const { file, options, writeId = crypto.randomUUID(), onProgress, signal } = params
		return this.operation(async (engine) => {
			const importing = engine.importFile({ file, options, writeId }, onProgress)
			const stopForwarding = forwardAbort({
				signal,
				abort: function abortInEngine() {
					return engine.abortImport({ writeId })
				},
			})
			try {
				return await importing
			} finally {
				stopForwarding()
			}
		})
	}

	// --- Export ---

	/**
	 * The export runs in the engine; its progress listener stays here (the engine's ticks come back on
	 * the call's port, before its answer) and its abort crosses as a call of its own, by an id of this call. The engine may finish before that call reaches
	 * it: an export its caller aborted before the answer is `EXPORT_ABORTED` all the same (an export
	 * leaves nothing behind); an error the engine answered stays.
	 */
	async exportFile(params: ExportFileParams): Promise<ExportFileResult> {
		const { documentId, options, onProgress, signal } = params
		const exportId = crypto.randomUUID()
		return this.operation(async (engine) => {
			const exporting = engine.exportFile({ documentId, options, exportId }, onProgress)
			const stopForwarding = forwardAbort({
				signal,
				abort: function abortInEngine() {
					return engine.abortExport({ exportId })
				},
			})
			try {
				const exported = await exporting
				throwIfExportAborted({ signal, documentId })
				return exported
			} finally {
				stopForwarding()
			}
		})
	}

	async getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome> {
		return this.operation((engine) => engine.getWriteOutcome(params))
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		return this.operation((engine) => engine.bulkWrite(documentId, ops))
	}

	/** The commit runs in the engine; its progress listener stays here, its ticks heard before the answer. */
	async commit(params: {
		documentId: string
		writeId?: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		const {
			documentId,
			writeId = crypto.randomUUID(),
			creates,
			updates,
			deletes,
			onProgress,
		} = params
		return this.operation((engine) =>
			engine.commit({ documentId, writeId, creates, updates, deletes }, onProgress),
		)
	}

	// --- History ---

	async undo(documentId: string): Promise<void> {
		return this.operation((engine) => engine.undo(documentId))
	}

	async redo(documentId: string): Promise<void> {
		return this.operation((engine) => engine.redo(documentId))
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		return this.operation((engine) => engine.getHistoryStatus(documentId))
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.operation((engine) => engine.getChangeLog(documentId))
	}

	/** No database object crosses the port: the engine owns it. */
	getDatabaseInstance(): unknown {
		return null
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		return this.operation((engine) => engine.addBlob(entry, data))
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.operation((engine) => engine.getBlob(blobId))
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.operation((engine) => engine.getBlobsByDocument(documentId))
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.operation((engine) => engine.getBlobsByRecord(documentId, recordRef))
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.operation((engine) => engine.getStandaloneBlobs())
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		return this.operation((engine) => engine.attachBlob(blobId, ref))
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		return this.operation((engine) => engine.detachBlob(blobId, ref))
	}

	async removeBlob(blobId: string): Promise<void> {
		return this.operation((engine) => engine.removeBlob(blobId))
	}

	// --- Private ---

	/**
	 * One operation of the port: refused once the store is closed; counted while it runs, so a
	 * `close()` meanwhile lets it complete and releases the link after it.
	 */
	private async operation<GenericResult>(
		run: (engine: EngineApi) => Promise<GenericResult>,
	): Promise<GenericResult> {
		if (this.closed) throwStoreClosed({ storeName: this.name })
		return this.tracked(async () => {
			const engine = await this.currentEngine()
			return run(engine)
		})
	}

	/** Counted while it runs; the last one to end on a closed store releases the link. */
	private async tracked<GenericResult>(run: () => Promise<GenericResult>): Promise<GenericResult> {
		this.operations.start()
		try {
			return await run()
		} finally {
			// released before `end` resolves a waiting open(), which then connects again
			if (this.operations.count === 1 && this.closed) this.releaseLink()
			this.operations.end()
		}
	}

	/** The engine through this store's link, connected on the first operation (once, however many run). */
	private async currentEngine(): Promise<EngineApi> {
		this.connecting ??= this.connectOnce()
		this.link = await this.connecting
		return this.link.engine()
	}

	/** A failed connection is forgotten: the next operation tries again. */
	private async connectOnce(): Promise<EngineLink> {
		try {
			return await this.connector.connect()
		} catch (thrown) {
			this.connecting = undefined
			throw thrown
		}
	}

	/** Called with no operation running, so no connection is under way. */
	private releaseLink(): void {
		this.link?.close()
		this.link = undefined
		this.connecting = undefined
	}
}

/**
 * Forward the caller's abort to the engine until the call (an import, an export) settles; answers the
 * function that stops it. The abort call's own failure is not reported: the call's answer says what
 * became of it.
 */
function forwardAbort(params: { signal?: AbortSignal; abort: () => Promise<void> }): () => void {
	const { signal, abort } = params
	if (!signal) return stopNothing
	function abortQuietly(): void {
		abort().catch(ignoreAbortFailure)
	}
	if (signal.aborted) {
		abortQuietly()
		return stopNothing
	}
	signal.addEventListener('abort', abortQuietly, { once: true })
	return function stopForwarding() {
		signal.removeEventListener('abort', abortQuietly)
	}
}

function stopNothing(): void {}

function ignoreAbortFailure(): void {}
