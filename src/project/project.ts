import { resolveStore } from '../store/resolve-store'
import { exportBlob, exportDocument, importDocument, initEmptyDocument } from './io'
import { resolveConfig } from './io/resolve-config'
import { buildDocumentState, reconcileDocumentState } from './state'
import {
	isImporting,
	isStaleImport,
	openableDocuments,
	STALE_IMPORT_MS,
} from './state/document-lifecycle'

import { Document } from '@/document'
import { createDialecteError, toDialecteError } from '@/errors'
import { mergeExtensions } from '@/helpers'
import { createPerf } from '@/perf'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
	ImportedDocument,
	ImportEntry,
	ExportDocumentOptions,
	ExportBlobOptions,
	ExportBlobResult,
	ProjectChannelMessage,
	ProjectParams,
	ProjectState,
	DocumentRecord,
} from './types'
import type { ExtensionModules, MergedExtensions, QueryExtensions, Query } from '@/document'
import type { Perf } from '@/perf'
import type { Store } from '@/store'
import type { AnyDialecteConfig, BlobAttachment, BlobRecord, DialecteHooks } from '@/types'

// ── Project class ────────────────────────────────────────────────────────────

/**
 * Project — top-level entry point for multi-file dialecte workspaces.
 *
 * Owns the Store, file registry, and configuration.
 * Documents are file-scoped views opened from a Project.
 */
export class Project<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericStore extends Store = Store,
> {
	private _name?: string
	private _store?: GenericStore
	/**
	 * The project channel: posts this realm's mutations and listens for other
	 * realms' (other tab / iframe / second Project instance). BroadcastChannel
	 * withholds a message from the exact instance that posted it, so this realm
	 * never receives its own posts — local state is maintained inline by the
	 * mutation methods, and the listener folds in only foreign messages.
	 */
	private _channel?: BroadcastChannel
	/** Set once close()/destroy() begins, to stop new channel-triggered store work. */
	private closing = false
	/** While open: the imports whose heartbeat went stale are swept every `STALE_IMPORT_MS`. */
	private staleSweep?: ReturnType<typeof setInterval>
	/** In-flight fire-and-forget work triggered by foreign messages, awaited on teardown. */
	private readonly pendingBroadcastWork = new Set<Promise<void>>()
	private readonly storage: ProjectParams<GenericConfig>['storage']
	private configs: Record<string, GenericConfig>
	private defaultConfigKey: string
	private mergedExtensions?: MergedExtensions<GenericModules>
	private hooks?: DialecteHooks<GenericConfig>
	/** Single project-lived dev perf helper; frozen no-op unless `dev.perf`. */
	readonly perf: Perf

	get name(): string {
		invariant(this._name !== undefined, {
			key: 'PROJECT_NOT_OPENED',
			detail: 'Call project.open(name) before accessing project properties.',
		})
		return this._name
	}

	/** The store of an open project: one never opened, closed or destroyed has none to read or write. */
	private get store(): GenericStore {
		invariant(this._store !== undefined && !this.closing, {
			key: 'PROJECT_NOT_OPENED',
			detail: this.closing
				? 'The project is closed: open it again before using it.'
				: 'Call project.open(name) before accessing project properties.',
		})
		return this._store
	}

	/**
	 * The imports of this project, one after the other: a call made while another import runs
	 * waits for it. The chain never blocks on a failed import; each caller gets its own outcome.
	 */
	private importChain: Promise<unknown> = Promise.resolve()

	/** Run `work` once every import queued before it has settled: one file in flight per project. */
	private enqueueImport<GenericResult>(work: () => Promise<GenericResult>): Promise<GenericResult> {
		const queued = this.importChain.then(work, work)
		this.importChain = queued
		return queued
	}

	/** Resolved once every import queued so far has settled, however it settled. */
	private settledImports(): Promise<void> {
		const settled = () => {}
		return this.importChain.then(settled, settled)
	}

	private get channel(): BroadcastChannel {
		invariant(this._channel !== undefined, {
			key: 'PROJECT_NOT_OPENED',
			detail: 'Call project.open(name) before accessing project properties.',
		})
		return this._channel
	}

	/**
	 * Name of this project's BroadcastChannel — the public event contract.
	 * Open your own instance (see createChannel) to receive every
	 * ProjectChannelMessage, same-tab and cross-tab.
	 */
	get channelName(): string {
		return `dialecte::project::${this.name}`
	}

	/**
	 * Convenience: a fresh BroadcastChannel on this project's channel.
	 * The caller owns it — call channel.close() when done listening.
	 */
	createChannel(): BroadcastChannel {
		return new BroadcastChannel(this.channelName)
	}

	/** Post a message on the project channel. */
	private broadcast(message: ProjectChannelMessage): void {
		this.channel.postMessage(message)
	}

	readonly state: ProjectState = {
		documents: new Map(),
		activeTransactions: 0,
	}

	/**
	 * In-realm reactive registry, keyed by documentId (parallel to `state.documents`).
	 * The sole bridge between core state mutations and a Vue-free consumer: a
	 * Document's progress reporter, a local commit's loading toggles, undo/redo, and
	 * the foreign-commit channel fold all call `signalStateChange(documentId)`, firing
	 * every callback a Document registered via `subscribe`. Distinct from the
	 * BroadcastChannel (cross-realm transport): this is synchronous, same-realm, and
	 * carries no payload — subscribers read the live shared `state` entry.
	 */
	private readonly stateSubscribers = new Map<string, Set<(terminal: boolean) => void>>()

	private subscribeState(documentId: string, callback: (terminal: boolean) => void): () => void {
		const set =
			this.stateSubscribers.get(documentId) ??
			this.stateSubscribers.set(documentId, new Set()).get(documentId)!
		set.add(callback)
		return () => set.delete(callback)
	}

	private signalStateChange(documentId: string, terminal: boolean): void {
		const set = this.stateSubscribers.get(documentId)
		if (!set) return
		for (const callback of set) callback(terminal)
	}

	constructor(params: {
		configs: Record<string, GenericConfig>
		defaultConfigKey?: string
		storage: ProjectParams<GenericConfig>['storage']
		extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
		hooks?: DialecteHooks<GenericConfig>
		dev?: { perf?: boolean }
	}) {
		const configKeys = Object.keys(params.configs)

		this.storage = params.storage
		this.configs = params.configs
		this.defaultConfigKey = params.defaultConfigKey ?? configKeys[0]
		this.hooks = params.hooks
		this.perf = createPerf({ enabled: params.dev?.perf ?? false })
		this.mergedExtensions = params.extensions
			? (mergeExtensions({
					base: params.extensions.base,
					custom: params.extensions.custom,
				}) as MergedExtensions<GenericModules>)
			: undefined
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * Open a named project: resolve store, open DB connection, hydrate state.
	 * Must be called before import/export/openDocument.
	 */
	async open(name: string): Promise<this> {
		this._name = name
		this.closing = false
		this._channel = new BroadcastChannel(this.channelName)
		this._channel.addEventListener('message', (event: MessageEvent<ProjectChannelMessage>) => {
			this.onChannelMessage(event.data)
		})

		const store = resolveStore(name, this.storage, this.configs[this.defaultConfigKey], this.perf)
		await store.open()
		this._store = store as GenericStore

		// A document still `importing` with a stale heartbeat was left by a realm that died: removed.
		// One with a live heartbeat is another realm's import in progress: left alone, not opened.
		const files = await sweepStaleImports(store)
		for (const file of files) {
			this.state.documents.set(file.id, buildDocumentState(file))
		}
		await Promise.all(files.map((file) => this.refreshHistoryStatus(file.id)))
		// A realm that dies while this one is open leaves the same leftover: swept periodically too.
		this.staleSweep = setInterval(() => {
			this.trackBroadcastWork(sweepStaleImports(store).then(() => {}))
		}, STALE_IMPORT_MS)

		return this
	}

	/**
	 * Fold an incoming channel message into project state. This realm never
	 * receives its own posts (BroadcastChannel withholds them from the posting
	 * instance), so this only ever handles foreign messages — another tab, an
	 * iframe, or a second Project instance. Local mutations maintain state inline.
	 */
	private onChannelMessage(message: ProjectChannelMessage | undefined): void {
		if (this.closing) return
		switch (message?.type) {
			case 'init-empty-document':
			case 'document-removed':
			case 'document-imported':
				// Reconcile the store schema before the registry so both converge
				// together for this realm. Tracked so teardown can await it — a late
				// foreign message must not read/reconcile the store after destroy()
				// deleted it.
				this.trackBroadcastWork(this.reconcileFromBroadcast(message.documentId))
				break
			case 'commit': {
				const entry = this.state.documents.get(message.documentId)
				if (entry) {
					entry.lastUpdate = message.timestamp ?? Date.now()
				}
				// Tracked fire-and-forget: a late foreign message must not refresh
				// flags on a store that teardown already closed.
				this.trackBroadcastWork(this.refreshHistoryStatus(message.documentId))
				// A cross-realm commit changed this document — wake local subscribers so
				// the UI refetches (the fold above already updated the shared entry).
				this.signalStateChange(message.documentId, true)
				break
			}
		}
	}

	/**
	 * Track channel-triggered fire-and-forget work so `close`/`destroy` can wait for
	 * it to settle before tearing down the store. A foreign message delivered as the
	 * project is closing would otherwise read or reconcile the store after it was
	 * closed/deleted — surfacing as DatabaseClosedError or ConstraintError. The work
	 * keeps its own error swallowing; here it is only awaited, never rethrown.
	 */
	private trackBroadcastWork(work: Promise<void>): void {
		const tracked = work
			.catch(() => {})
			.finally(() => {
				this.pendingBroadcastWork.delete(tracked)
			})
		this.pendingBroadcastWork.add(tracked)
	}

	/** Recompute canUndo/canRedo for a document from the store's history. */
	private async refreshHistoryStatus(documentId: string): Promise<void> {
		if (this.closing) return
		const entry = this.state.documents.get(documentId)
		if (!entry) return
		const { canUndo, canRedo } = await this.store.getHistoryStatus(documentId)
		entry.canUndo = canUndo
		entry.canRedo = canRedo
	}

	/**
	 * Close the store and release resources, once the imports in flight have landed - they
	 * broadcast on the live channel. From the call on, the project is closed: a new call throws
	 * `PROJECT_NOT_OPENED`.
	 */
	async close(): Promise<void> {
		this.closing = true
		await this.settledImports()
		clearInterval(this.staleSweep)
		this._channel?.close()
		this._store?.close()
	}

	/**
	 * Destroy the project - deletes the database entirely, once the imports in flight have landed.
	 */
	async destroy(): Promise<void> {
		this.closing = true
		await this.settledImports()
		this._channel?.close()
		// Wait for any in-flight foreign-message work to settle on the live store
		// before deleting it, so no read/reconcile outlives the database.
		await Promise.allSettled(this.pendingBroadcastWork)
		await this._store?.destroy()
		this.state.documents.clear()
	}

	// ── File management ──────────────────────────────────────────────────────

	/**
	 * Register a new empty document in the project.
	 * Returns the new documentId. Records are added later via import or transactions.
	 */
	async initEmptyDocument(options?: InitEmptyDocumentOptions): Promise<string> {
		const result = await initEmptyDocument({
			store: this.store,
			configs: this.configs,
			defaultConfigKey: this.defaultConfigKey,
			options,
			// Erase to the config-agnostic pipeline shape at this single core-internal
			// boundary (the IO/init pipeline is config-registry-driven).
			hooks: this.hooks as DialecteHooks<AnyDialecteConfig> | undefined,
		})

		this.state.documents.set(result.documentId, result.documentState)
		this.broadcast({
			type: 'init-empty-document',
			documentId: result.documentId,
			timestamp: Date.now(),
		})

		return result.documentId
	}

	/**
	 * Remove a file and all its records.
	 */
	async removeDocument(documentId: string): Promise<void> {
		await this.store.removeDocument(documentId)
		this.state.documents.delete(documentId)
		this.broadcast({ type: 'document-removed', documentId, timestamp: Date.now() })
	}

	// ── Import / Export ──────────────────────────────────────────────────────

	/**
	 * What is about an import call, checked at the call and before any file: an open project (its
	 * store, which the import then writes to even if the project closes meanwhile), a known
	 * `configKey`.
	 */
	private importStore(options?: ImportDocumentOptions): GenericStore {
		const store = this.store
		resolveConfig({
			configs: this.configs,
			defaultConfigKey: this.defaultConfigKey,
			configKey: options?.configKey,
		})
		return store
	}

	/**
	 * Import Files into the project: one entry per file, in the order given. The files are imported
	 * one after the other - memory is bounded by one file's batches, the registry sees one import -
	 * and a file that fails is its own `failed` entry, the next file still attempted: nothing of a
	 * failed file lands. The call itself rejects only for what is about the call: an unknown
	 * `configKey`, a project not open.
	 */
	async import(files: File[], options?: ImportDocumentOptions): Promise<ImportEntry[]> {
		this.importStore(options)

		const entries: ImportEntry[] = []
		for (const file of files) {
			try {
				entries.push({ status: 'imported', ...(await this.importFile(file, options)) })
			} catch (thrown) {
				// the structured error thrown - `PARSE_ERROR`, a dialecte's own from a hook - or
				// `IMPORT_FAILED` wrapping anything else: `createDialecteError` sets the structured error
				// as the Error's cause, so read back it is never undefined
				const error =
					toDialecteError(thrown) ??
					toDialecteError(
						createDialecteError('IMPORT_FAILED', {
							detail: thrown instanceof Error ? thrown.message : String(thrown),
							cause: thrown instanceof Error ? thrown : undefined,
						}),
					)!
				entries.push({ status: 'failed', fileName: file.name, error })
			}
		}
		return entries
	}

	/**
	 * Import one File into the project: register, parse XML, persist records. The document is in
	 * the project state and broadcast once its last record is stored; whatever fails before that
	 * removes it again and is thrown (`PARSE_ERROR` for a malformed file). One file is in flight
	 * per project: a call made while another import runs waits for it.
	 */
	async importFile(file: File, options?: ImportDocumentOptions): Promise<ImportedDocument> {
		const store = this.importStore(options)
		return this.enqueueImport(() => this.importOne({ file, options, store }))
	}

	private async importOne(params: {
		file: File
		options?: ImportDocumentOptions
		store: GenericStore
	}): Promise<ImportedDocument> {
		const { file, options, store } = params
		const result = await importDocument({
			file,
			store,
			configs: this.configs,
			defaultConfigKey: this.defaultConfigKey,
			options,
			// Erase to the config-agnostic pipeline shape at this single
			// core-internal boundary (the import pipeline is registry-driven).
			hooks: this.hooks as DialecteHooks<AnyDialecteConfig> | undefined,
			perf: this.perf,
		})
		this.state.documents.set(result.documentId, result.documentState)
		this.broadcast({
			type: 'document-imported',
			documentId: result.documentId,
			timestamp: Date.now(),
		})
		return {
			fileName: file.name,
			documentId: result.documentId,
			recordCount: result.recordCount,
			diagnostics: result.diagnostics,
		}
	}

	/**
	 * Export a document as an XMLDocument built from stored records.
	 */
	async export(
		documentId: string,
		options?: ExportDocumentOptions,
	): Promise<{ xmlDocument: XMLDocument; filename: string }> {
		return exportDocument({
			documentId,
			state: this.state,
			configs: this.configs,
			store: this.store,
			projectName: this.name,
			options,
		})
	}

	// ── File registry ────────────────────────────────────────────────────────

	/** The documents of the project; one still importing - here or in another realm - is not among them. */
	async getDocuments(): Promise<DocumentRecord[]> {
		return openableDocuments(await this.store.getDocuments())
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		const record = await this.store.getDocument(documentId)
		return record && !isImporting(record) ? record : undefined
	}

	// ── Document access ──────────────────────────────────────────────────────

	/**
	 * Open a file-scoped Document for querying and mutating a specific file.
	 */
	openDocument(documentId: string): Document<GenericConfig, MergedExtensions<GenericModules>> {
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		const config = this.configs[documentState.record.configKey]
		return new Document(this.store, config, documentId, this.mergedExtensions, this.hooks, {
			// Shared with project state: every Document instance for this
			// documentId mutates the same entry the Project (and its channel
			// fold) maintains.
			state: documentState,
			channelName: this.channelName,
			broadcast: (message) => this.broadcast(message),
			// Lets a local commit refresh canUndo/canRedo on the shared entry
			// synchronously, without a channel round-trip.
			refreshHistoryStatus: () => this.refreshHistoryStatus(documentId),
			perf: this.perf,
			subscribeState: (callback) => this.subscribeState(documentId, callback),
			signalStateChange: (terminal) => this.signalStateChange(documentId, terminal),
		})
	}

	/**
	 * Reconcile this realm's store against persisted state, then report the
	 * document's liveness and readiness:
	 * - `live`  — the document is registered in this realm's registry (so
	 *   `openDocument` will not throw DOCUMENT_NOT_REGISTERED).
	 * - `ready` — the store can serve the document's records (so reads / export
	 *   will not throw, e.g. a missing per-document table).
	 *
	 * Ordering-independent: safe to call as soon as an active-document signal
	 * arrives in another realm, even before the import broadcast has been folded
	 * in. Returns `{ live: false, ready: false }` for an unknown document rather
	 * than throwing.
	 */
	async getDocumentStatus(documentId: string): Promise<{ live: boolean; ready: boolean }> {
		await this.store.reconcile(documentId)
		await this.refreshState()
		const live = this.state.documents.has(documentId)
		const ready = live && (await this.store.isDocumentReadable(documentId))
		return { live, ready }
	}

	/**
	 * Get the config for a specific file.
	 */
	getDocumentConfig(documentId: string): GenericConfig | undefined {
		const documentState = this.state.documents.get(documentId)
		if (!documentState) return undefined
		return this.configs[documentState.record.configKey]
	}

	// ── Undo / Redo ──────────────────────────────────────────────────────────

	async undo(documentId: string): Promise<void> {
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		await this.store.undo(documentId)
		// Update local state deterministically (the channel echo would do this
		// too, but asynchronously) before announcing.
		const timestamp = Date.now()
		documentState.lastUpdate = timestamp
		await this.refreshHistoryStatus(documentId)
		this.signalStateChange(documentId, true)
		this.broadcast({ type: 'commit', documentId, timestamp })
	}

	async redo(documentId: string): Promise<void> {
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		await this.store.redo(documentId)
		const timestamp = Date.now()
		documentState.lastUpdate = timestamp
		await this.refreshHistoryStatus(documentId)
		this.signalStateChange(documentId, true)
		this.broadcast({ type: 'commit', documentId, timestamp })
	}

	// ── Blobs ────────────────────────────────────────────────────────────────

	/**
	 * Add a blob owned by `documentId`. The binary lives in `blob_{documentId}`.
	 * Returns the generated blob id.
	 */
	async addBlob(
		documentId: string,
		file: File,
		attachedTo: BlobAttachment[] = [],
	): Promise<string> {
		const entry: BlobRecord = {
			id: crypto.randomUUID(),
			documentId,
			name: file.name,
			mimeType: file.type || undefined,
			size: file.size,
			createdAt: Date.now(),
			attachedTo,
		}
		await this.store.addBlob(entry, file)
		this.broadcast({ type: 'blob-added', blobId: entry.id, documentId, timestamp: Date.now() })
		return entry.id
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.store.getBlob(blobId)
	}

	/**
	 * Export a blob from the store. Mirrors `export(documentId)` for blobs:
	 * returns `{ entry, data, filename }` and optionally triggers a download via
	 * `options.withDownload`.
	 */
	async exportBlob(blobId: string, options?: ExportBlobOptions): Promise<ExportBlobResult> {
		return exportBlob({ blobId, store: this.store, options })
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.store.getBlobsByDocument(documentId)
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.store.getBlobsByRecord(documentId, recordRef)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.store.getStandaloneBlobs()
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		await this.store.attachBlob(blobId, ref)
		this.broadcast({ type: 'blob-attached', blobId, ref, timestamp: Date.now() })
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		await this.store.detachBlob(blobId, ref)
		this.broadcast({ type: 'blob-detached', blobId, ref, timestamp: Date.now() })
	}

	async removeBlob(blobId: string): Promise<void> {
		await this.store.removeBlob(blobId)
		this.broadcast({ type: 'blob-removed', blobId, timestamp: Date.now() })
	}

	// ── Cross-document queries ───────────────────────────────────────────────

	/**
	 * Run a query function across all documents, return the first non-undefined result.
	 * Iterates documents sequentially; stops at the first match.
	 */
	async queryFirst<Result>(
		queryFunction: (
			query: Query<GenericConfig> & QueryExtensions<MergedExtensions<GenericModules>>,
		) => Promise<Result | undefined>,
	): Promise<Result | undefined> {
		for (const documentId of this.state.documents.keys()) {
			const doc = this.openDocument(documentId)
			const result = await queryFunction(doc.query)
			if (result !== undefined) return result
		}
		return undefined
	}

	/**
	 * Run a query function across all documents, collect and flatten results.
	 * Iterates documents sequentially; merges all non-empty arrays.
	 */
	async queryAll<Result>(
		queryFunction: (
			query: Query<GenericConfig> & QueryExtensions<MergedExtensions<GenericModules>>,
		) => Promise<Result[]>,
	): Promise<Result[]> {
		const results: Result[] = []
		for (const documentId of this.state.documents.keys()) {
			const doc = this.openDocument(documentId)
			const result = await queryFunction(doc.query)
			results.push(...result)
		}
		return results
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	/** Expose the underlying database instance. Return type is inferred from the store (Dexie for local storage). */
	getDatabaseInstance(): ReturnType<GenericStore['getDatabaseInstance']> {
		return this.store.getDatabaseInstance() as ReturnType<GenericStore['getDatabaseInstance']>
	}

	private async refreshState(): Promise<void> {
		const files = await this.store.getDocuments()
		reconcileDocumentState(this.state.documents, openableDocuments(files))
	}

	/**
	 * Fold a cross-realm import/removal into this realm: first reconcile the
	 * store schema (so a newly-imported document's backing table exists here),
	 * then refresh the in-memory registry. Ordered so liveness and readiness
	 * converge together.
	 */
	private async reconcileFromBroadcast(documentId?: string): Promise<void> {
		if (this.closing) return
		await this.store.reconcile(documentId)
		await this.refreshState()
	}
}

/** Remove the imports nobody runs any more and return the documents to open. */
async function sweepStaleImports(store: Store): Promise<DocumentRecord[]> {
	const files = await store.getDocuments()
	const now = Date.now()
	const stale = files.filter((file) => isStaleImport(file, now))
	await Promise.all(stale.map((file) => store.removeDocument(file.id)))
	return openableDocuments(files)
}
