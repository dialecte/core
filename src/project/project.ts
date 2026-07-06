import { resolveStore } from '../store/resolve-store'
import { exportBlob, exportDocument, importDocument, initEmptyDocument } from './io'
import { buildDocumentState, reconcileDocumentState } from './state'

import { Document } from '@/document'
import { mergeExtensions } from '@/helpers'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
	ExportDocumentOptions,
	ExportBlobOptions,
	ExportBlobResult,
	ProjectParams,
	ProjectState,
	DocumentRecord,
} from './types'
import type { ExtensionModules, MergedExtensions, QueryExtensions, Query } from '@/document'
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
	private _channel?: BroadcastChannel
	private readonly storage: ProjectParams<GenericConfig>['storage']
	private configs: Record<string, GenericConfig>
	private defaultConfigKey: string
	private mergedExtensions?: MergedExtensions<GenericModules>
	private hooks?: DialecteHooks<GenericConfig>

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

	readonly state: ProjectState = {
		documents: new Map(),
		activeTransactions: 0,
	}

	constructor(params: {
		configs: Record<string, GenericConfig>
		defaultConfigKey?: string
		storage: ProjectParams<GenericConfig>['storage']
		extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
		hooks?: DialecteHooks<GenericConfig>
	}) {
		const configKeys = Object.keys(params.configs)

		this.storage = params.storage
		this.configs = params.configs
		this.defaultConfigKey = params.defaultConfigKey ?? configKeys[0]
		this.hooks = params.hooks
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
		this._channel = new BroadcastChannel(`dialecte::project::${name}`)
		this._channel.onmessage = (event: MessageEvent<{ type: string }>) => {
			const { type } = event.data ?? {}
			if (
				type === 'init-empty-document' ||
				type === 'document-removed' ||
				type === 'document-imported'
			) {
				this.refreshState()
			}
		}
		const store = resolveStore(name, this.storage, this.configs[this.defaultConfigKey])
		await store.open()
		this._store = store as GenericStore

		const files = await store.getDocuments()
		for (const file of files) {
			this.state.documents.set(file.id, buildDocumentState(file))
		}

		return this
	}

	/**
	 * Close the store and release resources.
	 */
	close(): void {
		this.channel.close()
		this.store.close()
	}

	/**
	 * Destroy the project - deletes the database entirely.
	 */
	async destroy(): Promise<void> {
		this.channel.close()
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
		this.channel.postMessage({ type: 'init-empty-document', documentId: result.documentId })

		return result.documentId
	}

	/**
	 * Remove a file and all its records.
	 */
	async removeDocument(documentId: string): Promise<void> {
		await this.store.removeDocument(documentId)
		this.state.documents.delete(documentId)
		this.channel.postMessage({ type: 'document-removed', documentId })
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
				}),
			),
		)

		for (const result of results) {
			this.state.documents.set(result.documentId, result.documentState)
			this.channel.postMessage({ type: 'document-imported', documentId: result.documentId })
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
		return new Document(
			this.store,
			config,
			documentId,
			this.mergedExtensions,
			this.hooks,
			this.channel,
		)
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
		this.channel.postMessage({ type: 'commit', documentId, timestamp: Date.now() })
	}

	async redo(documentId: string): Promise<void> {
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		await this.store.redo(documentId)
		this.channel.postMessage({ type: 'commit', documentId, timestamp: Date.now() })
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
		this.channel.postMessage({ type: 'blob-added', blobId: entry.id, documentId })
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
		this.channel.postMessage({ type: 'blob-attached', blobId, ref })
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		await this.store.detachBlob(blobId, ref)
		this.channel.postMessage({ type: 'blob-detached', blobId, ref })
	}

	async removeBlob(blobId: string): Promise<void> {
		await this.store.removeBlob(blobId)
		this.channel.postMessage({ type: 'blob-removed', blobId })
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
}
