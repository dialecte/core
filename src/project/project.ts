import { resolveStore } from '../store/resolve-store'
import { exportBlob, exportDocument, importDocument, initEmptyDocument } from './io'
import { buildDocumentState, reconcileDocumentState } from './state'

import { Document } from '@/document'
import { mergeExtensions } from '@/helpers'
import { createPerf } from '@/perf'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
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

	private get store(): GenericStore {
		invariant(this._store !== undefined, {
			key: 'PROJECT_NOT_OPENED',
			detail: 'Call project.open(name) before accessing project properties.',
		})
		return this._store
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

		const files = await store.getDocuments()
		for (const file of files) {
			this.state.documents.set(file.id, buildDocumentState(file))
		}
		await Promise.all(files.map((file) => this.refreshHistoryStatus(file.id)))

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
	 * Close the store and release resources.
	 */
	close(): void {
		this.closing = true
		this._channel?.close()
		this.store.close()
	}

	/**
	 * Destroy the project - deletes the database entirely.
	 */
	async destroy(): Promise<void> {
		this.closing = true
		this._channel?.close()
		// Wait for any in-flight foreign-message work to settle on the live store
		// before deleting it, so no read/reconcile outlives the database.
		await Promise.allSettled(this.pendingBroadcastWork)
		await this.store.destroy()
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
	 * Import one or more Files into the project: register, parse XML, persist records.
	 */
	async import(
		files: File[],
		options?: ImportDocumentOptions,
	): Promise<Array<{ documentId: string; recordCount: number }>> {
		const results = await Promise.all(
			files.map((file) =>
				importDocument({
					file,
					store: this.store,
					configs: this.configs,
					defaultConfigKey: this.defaultConfigKey,
					options,
					// Erase to the config-agnostic pipeline shape at this single
					// core-internal boundary (the import pipeline is registry-driven).
					hooks: this.hooks as DialecteHooks<AnyDialecteConfig> | undefined,
					perf: this.perf,
				}),
			),
		)

		for (const result of results) {
			this.state.documents.set(result.documentId, result.documentState)
			this.broadcast({
				type: 'document-imported',
				documentId: result.documentId,
				timestamp: Date.now(),
			})
		}

		return results.map(({ documentId, recordCount }) => ({ documentId, recordCount }))
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

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.store.getDocuments()
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.store.getDocument(documentId)
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
		reconcileDocumentState(this.state.documents, files)
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
