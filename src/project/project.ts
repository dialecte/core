import { resolveStore } from '../store/resolve-store'
import { exportDocument, importDocument, initEmptyDocument } from './io'
import { buildDocumentState, reconcileDocumentState } from './state'

import { Document } from '@/document'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
	ExportDocumentOptions,
	ProjectParams,
	ProjectState,
	DocumentRecord,
} from './types'
import type { ExtensionsRegistry } from '@/document'
import type { Store } from '@/store'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

// ── Project class ────────────────────────────────────────────────────────────

/**
 * Project — top-level entry point for multi-file dialecte workspaces.
 *
 * Owns the Store, file registry, and configuration.
 * Documents are file-scoped views opened from a Project.
 */
export class Project<
	GenericConfig extends AnyDialecteConfig,
	GenericExtension extends ExtensionsRegistry = {},
	GenericStore extends Store = Store,
> {
	private _name?: string
	private _store?: GenericStore
	private _channel?: BroadcastChannel
	private readonly storage: ProjectParams<GenericConfig>['storage']
	private configs: Record<string, GenericConfig>
	private defaultConfigKey: string
	private extensionsRegistry?: GenericExtension
	private hooks?: TransactionHooks<GenericConfig>

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
		extensionsRegistry?: GenericExtension
		hooks?: TransactionHooks<GenericConfig>
	}) {
		const configKeys = Object.keys(params.configs)

		this.storage = params.storage
		this.configs = params.configs
		this.defaultConfigKey = params.defaultConfigKey ?? configKeys[0]
		this.extensionsRegistry = params.extensionsRegistry
		this.hooks = params.hooks
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
	 * Import a File into the project: register, parse XML, persist records.
	 */
	async import(
		file: File,
		options?: ImportDocumentOptions,
	): Promise<{ documentId: string; recordCount: number }> {
		const result = await importDocument({
			file,
			store: this.store,
			configs: this.configs,
			defaultConfigKey: this.defaultConfigKey,
			options,
		})

		this.state.documents.set(result.documentId, result.documentState)
		this.channel.postMessage({ type: 'document-imported', documentId: result.documentId })

		return { documentId: result.documentId, recordCount: result.recordCount }
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
	openDocument(documentId: string): Document<GenericConfig, GenericExtension> {
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		const config = this.configs[documentState.document.configKey]
		return new Document(
			this.store,
			config,
			documentId,
			this.extensionsRegistry,
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
		return this.configs[documentState.document.configKey]
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
