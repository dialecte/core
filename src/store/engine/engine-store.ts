import { createClosingConnections } from '../closing-connections'
import { ignoreDestroyOutcome } from '../ignore-destroy-outcome'
import { refuseUnnamableProject } from '../project-name'
import { createRunningOperations } from '../running-operations'
import { throwStoreClosed } from '../store-errors'
import { ENGINE_WIRE_MEMBERS } from './wire/wire.constants'

import { toDialecteError } from '@/errors'
import { throwIfExportAborted } from '@/project/io/run-export'

import type {
	ChangeLogEntry,
	ExportFileParams,
	ExportFileResult,
	ImportFileParams,
	ImportFileResult,
	Store,
	StoreChange,
	StoreNotice,
	WriteOutcome,
} from '../store.types'
import type {
	EngineConnector,
	EngineLink,
	EngineStoreParams,
	LinkNotice,
} from './engine-store.types'
import type { EngineApi } from './engine.types'
import type { EngineEventSignal } from './host/host.types'
import type { WireMemberSpec } from './wire/wire.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'
import type { AnyRawRecord, BlobAttachment, BlobRecord, RecordPatch } from '@/types'

/** The stores of each name in this realm closed with operations running: a destroy of the name waits for those. */
const CLOSING_ENGINE_STORES = createClosingConnections()

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
	/** This store's own destroy while it runs: an operation started meanwhile connects once it has ended. */
	private destroying: Promise<void> | undefined
	/** How many times `close()` was called: an `open()` refuses when one came after it was called. */
	private closings = 0
	/** The last release of the link: what a `close()` waits for. */
	private linkReleased: Promise<void> = Promise.resolve()
	/** The operations running: `close()` releases the link, `open()` and `destroy()` go on, once none is left. */
	private readonly operations = createRunningOperations()
	/** What `subscribe` was given: told every change of the project, through each link this store makes. */
	private readonly listeners = new Set<(notice: StoreNotice) => void>()
	/** The current link's notices let go: called when the link is released, or nobody listens any more. */
	private stopNotices: () => void = stopNothing
	/** The link whose notices this store hears now. */
	private listenedLink: EngineLink | undefined
	/**
	 * The writes of this store refused `STORE_ENGINE_LOST`, by id: one that lands later is announced as another
	 * connection's, so whoever listens folds it in. Forgotten once told, once its outcome answers settled (`applied`,
	 * `not-applied`), at a resync (the engine gone tells nothing more) and once the link is released.
	 */
	private readonly lostWrites = new Set<string>()

	constructor(params: EngineStoreParams) {
		refuseUnnamableProject({ project: params.name })
		this.name = params.name
		this.connector = params.connector
	}

	// --- Lifecycle ---

	/** Connect to the project's engine (started when none runs: a file of another layout is refused there). */
	async open(): Promise<void> {
		const closingsAtCall = this.closings
		// an operation still running keeps the link: the store opens once it is done, and once its own
		// destroy has ended
		await this.operations.whenIdle()
		while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
		// a close() called after this open() wins: the store stays closed
		if (this.closings !== closingsAtCall) throwStoreClosed({ storeName: this.name })
		this.closed = false
		await this.tracked(async () => {
			await this.currentEngine()
		})
	}

	/**
	 * Refuse every operation started from now on until opened again; the link goes once the running ones
	 * end - a destroy of the name in the realm waits for them, as for its own - and the close is settled once
	 * the link is released: its engine's lock let go, or the hub told it left.
	 */
	async close(): Promise<void> {
		this.closed = true
		this.closings += 1
		if (this.operations.count === 0) return this.releaseLink()
		const idle = this.operations.whenIdle()
		CLOSING_ENGINE_STORES.markClosing({ name: this.name, until: idle })
		await idle
		// released by the last operation as it ended
		await this.linkReleased
	}

	/**
	 * Delete the project, once the operations running complete - its own, and those of a store of the name
	 * closed with operations running - every store of the name then reads empty; refused
	 * `PROJECT_OPEN_ELSEWHERE` while another connection has it open.
	 */
	async destroy(): Promise<void> {
		// one destroy of this store at a time: another one called meanwhile starts once it has ended
		while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
		const destroying = this.destroyOnceIdle()
		this.destroying = destroying
		try {
			await destroying
		} finally {
			if (this.destroying === destroying) this.destroying = undefined
		}
	}

	private async destroyOnceIdle(): Promise<void> {
		await this.operations.whenIdle()
		await CLOSING_ENGINE_STORES.settled({ name: this.name })
		// its own link counts not against it, and goes only once the destroy goes ahead: refused, the store
		// stays as it was - no other destroy finds it let go meanwhile
		const own = this.link && { link: this.link, letGo: this.releaseLink.bind(this) }
		await this.connector.destroy({ own })
		void this.releaseLink()
	}

	// --- Change announcement ---

	/**
	 * Every change of the project, this store's own and its other connections', told once each (its own before the
	 * call that made it settles); a write of its own that was refused `STORE_ENGINE_LOST` and landed later is told
	 * as another's. `resync` once the store reached another engine. Kept across `close()` and `open()`.
	 */
	subscribe(listener: (notice: StoreNotice) => void): () => void {
		this.listeners.add(listener)
		if (this.link) this.listenToLink({ link: this.link })
		return () => {
			this.listeners.delete(listener)
			// a link listened to follows its project's next engine at once: only while someone listens
			if (this.listeners.size === 0) this.stopListeningToLink()
		}
	}

	/** The link's notices told to this store's listeners, once (a link listened to follows its next engine). */
	private listenToLink(params: { link: EngineLink }): void {
		const { link } = params
		if (this.listeners.size === 0 || this.listenedLink === link) return
		this.stopListeningToLink()
		this.listenedLink = link
		this.stopNotices = link.onNotice((notice) => this.tellListeners({ notice, link }))
	}

	private stopListeningToLink(): void {
		this.stopNotices()
		this.stopNotices = stopNothing
		this.listenedLink = undefined
	}

	// --- Cross-realm reconciliation ---

	/** Nothing to bring in sync: the engine answers every connection from one state. */
	async reconcile(): Promise<void> {
		return this.operation({ readRetried: false, run: async () => undefined })
	}

	/** A document is readable once registered, as on every store. */
	async isDocumentReadable(documentId: string): Promise<boolean> {
		const document = await this.call('getDocument', documentId)
		return document !== undefined
	}

	// --- File registry ---

	async registerDocument(file: DocumentRecord): Promise<void> {
		return this.call('registerDocument', file)
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.call('getDocument', documentId)
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.call('getDocuments')
	}

	async updateDocument(documentId: string, updates: DocumentUpdates): Promise<void> {
		await this.call('updateDocument', documentId, updates)
	}

	async removeDocument(documentId: string): Promise<void> {
		await this.call('removeDocument', documentId)
	}

	// --- Record access ---

	async get(id: string, documentId: string): Promise<AnyRawRecord | undefined> {
		return this.call('get', id, documentId)
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return this.call('getByDocumentId', documentId)
	}

	async count(documentId: string): Promise<number> {
		return this.call('count', documentId)
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		return this.call('getByTagNameInDocument', tagName, documentId)
	}

	async getMany(ids: string[], documentId: string): Promise<(AnyRawRecord | undefined)[]> {
		return this.call('getMany', ids, documentId)
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
		// a write its caller identifies: never made again, its outcome asked by its id
		return this.operation({
			readRetried: false,
			run: async (engine) => {
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
			},
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
		// never made again: an export can be large, its caller asks again
		return this.operation({
			readRetried: false,
			run: async (engine) => {
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
			},
		})
	}

	async getWriteOutcome(params: { writeId: string }): Promise<WriteOutcome> {
		const outcome = await this.call('getWriteOutcome', params)
		// settled: its change came before this answer, on the same port, or never comes - its id forgotten
		if (outcome !== 'running') this.lostWrites.delete(params.writeId)
		return outcome
	}

	// --- Writes ---

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		await this.call('bulkWrite', documentId, ops)
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
		return this.call('commit', { documentId, writeId, creates, updates, deletes }, onProgress)
	}

	// --- History ---

	async undo(documentId: string): Promise<void> {
		await this.call('undo', documentId)
	}

	async redo(documentId: string): Promise<void> {
		await this.call('redo', documentId)
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		return this.call('getHistoryStatus', documentId)
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.call('getChangeLog', documentId)
	}

	/** No database object crosses the port: the engine owns it. */
	getDatabaseInstance(): unknown {
		return null
	}

	// --- Blob storage ---

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		return this.call('addBlob', entry, data)
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.call('getBlob', blobId)
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.call('getBlobsByDocument', documentId)
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.call('getBlobsByRecord', documentId, recordRef)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.call('getStandaloneBlobs')
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		await this.call('attachBlob', blobId, ref)
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		await this.call('detachBlob', blobId, ref)
	}

	async removeBlob(blobId: string): Promise<void> {
		await this.call('removeBlob', blobId)
	}

	// --- Private ---

	/**
	 * A call of the engine's `member` as one operation of the port; a read (the wire table says which,
	 * for the member this calls) whose engine ended with its host is made once more on the link's next
	 * engine. Its arguments are the member's own, forwarded as they are (not one params object).
	 */
	private async call<GenericMember extends keyof EngineApi>(
		member: GenericMember,
		...args: Parameters<EngineApi[GenericMember]>
	): Promise<Awaited<ReturnType<EngineApi[GenericMember]>>> {
		const spec: WireMemberSpec = ENGINE_WIRE_MEMBERS[member]
		return this.operation({
			readRetried: spec.read === true,
			run: function callMember(engine) {
				return Reflect.apply(engine[member], engine, args) as Promise<
					Awaited<ReturnType<EngineApi[GenericMember]>>
				>
			},
		})
	}

	/**
	 * One operation of the port: refused once the store is closed; counted while it runs, so a
	 * `close()` meanwhile lets it complete and releases the link after it. `readRetried`: refused
	 * because its engine ended with its host, it is made once more, on the link's next engine. Never
	 * on `realm-dropped` (or `no-heartbeat`): a dropped view reaches no engine until its page binds it
	 * again, every call refused alike meanwhile, and a silent engine may still be running.
	 */
	private async operation<GenericResult>(params: {
		readRetried: boolean
		run: (engine: EngineApi) => Promise<GenericResult>
	}): Promise<GenericResult> {
		const { readRetried, run } = params
		if (this.closed) throwStoreClosed({ storeName: this.name })
		// one started while this store's own destroy runs goes on once it has ended, not counted meanwhile:
		// it keeps that destroy, which waits for the operations counted, from nothing
		if (this.destroying) {
			while (this.destroying) await this.destroying.catch(ignoreDestroyOutcome)
			// closed while it waited: refused, as one started after the close is
			if (this.closed) throwStoreClosed({ storeName: this.name })
		}
		return this.tracked(async () => {
			const engine = await this.currentEngine()
			try {
				return await run(engine)
			} catch (thrown) {
				this.noteLostWrite({ thrown })
				if (!readRetried || !isHostGone({ thrown })) throw thrown
				const nextEngine = await this.currentEngine()
				return run(nextEngine)
			}
		})
	}

	/**
	 * A change the engine announced, as this store tells it: its own when its link made it - but for a write of its own
	 * refused lost, told once as another's (its caller saw it fail), its id forgotten then.
	 */
	private changeOf(params: { signal: EngineEventSignal; link: EngineLink }): StoreChange {
		const { signal, link } = params
		const { writeId } = signal
		const lost = writeId !== undefined && this.lostWrites.delete(writeId)
		return {
			type: 'change',
			message: signal.message,
			own: signal.connectionId === link.connectionId && !lost,
		}
	}

	/** A write refused `STORE_ENGINE_LOST` (its id on the refusal): its change, if it lands, is told as another's. */
	private noteLostWrite(params: { thrown: unknown }): void {
		const error = toDialecteError(params.thrown)
		const writeId = error?.meta?.writeId
		if (error?.key === 'STORE_ENGINE_LOST' && typeof writeId === 'string')
			this.lostWrites.add(writeId)
	}

	/** Counted while it runs; the last one to end on a closed store releases the link. */
	private async tracked<GenericResult>(run: () => Promise<GenericResult>): Promise<GenericResult> {
		this.operations.start()
		try {
			return await run()
		} finally {
			// released before `end` resolves a waiting open(), which then connects again
			if (this.operations.count === 1 && this.closed) void this.releaseLink()
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
			const link = await this.connector.connect()
			this.listenToLink({ link })
			return link
		} catch (thrown) {
			this.connecting = undefined
			throw thrown
		}
	}

	/** A link's notice told to every listener; one that throws stops no other. */
	private tellListeners(params: { notice: LinkNotice; link: EngineLink }): void {
		const { notice, link } = params
		// another engine: a lost write's change, which the engine gone never told, never comes
		if (notice.type === 'resync') this.lostWrites.clear()
		const told: StoreNotice =
			notice.type === 'resync' ? notice : this.changeOf({ signal: notice.signal, link })
		for (const listener of Array.from(this.listeners)) {
			try {
				listener(told)
			} catch {
				// a listener's own failure: the others are told all the same
			}
		}
	}

	/** Called with no operation running, so no connection is under way; settled once the link counts no more. */
	private releaseLink(): Promise<void> {
		this.stopListeningToLink()
		// a lost write's change came on this link, or never comes: nothing more is heard of it
		this.lostWrites.clear()
		// a link released already: a later close waits for that release still
		if (this.link) this.linkReleased = this.link.close()
		this.link = undefined
		this.connecting = undefined
		return this.linkReleased
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

/** Refused because its engine ended with its host (not because it went silent: it may still be running). */
function isHostGone(params: { thrown: unknown }): boolean {
	const error = toDialecteError(params.thrown)
	return error?.key === 'STORE_ENGINE_LOST' && error.meta?.reason === 'host-gone'
}

/** Nothing to stop: no link listened to, no forwarding of an abort. */
function stopNothing(): void {}

function ignoreAbortFailure(): void {}
