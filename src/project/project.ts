import { resolveStore } from '../store/resolve-store'
import { exportDocument, importDocument, initEmptyDocument } from './io'
import { buildDocumentState, reconcileDocumentState } from './state'

import { Document } from '@/document'
import { mergeExtensions } from '@/helpers'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
	ExportDocumentOptions,
	ProjectOpenParams,
	ProjectState,
	DocumentRecord,
} from './types'
import type { ExtensionModules, ExtensionsRegistry, MergedExtensions } from '@/document'
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
> {
	readonly name: string
	private store: Store
	private configs: Record<string, GenericConfig>
	private defaultConfigKey: string
	private extensionsRegistry?: GenericExtension
	private hooks?: TransactionHooks<GenericConfig>
	private channel: BroadcastChannel

	readonly state: ProjectState = {
		documents: new Map(),
		activeTransactions: 0,
	}

	private constructor(
		name: string,
		store: Store,
		configs: Record<string, GenericConfig>,
		defaultConfigKey: string,
		extensionsRegistry?: GenericExtension,
		hooks?: TransactionHooks<GenericConfig>,
	) {
		this.name = name
		this.store = store
		this.configs = configs
		this.defaultConfigKey = defaultConfigKey
		this.extensionsRegistry = extensionsRegistry
		this.hooks = hooks
		this.channel = new BroadcastChannel(`dialecte::project::${name}`)
		this.channel.onmessage = (event: MessageEvent<{ type: string }>) => {
			const { type } = event.data ?? {}
			if (
				type === 'document-created' ||
				type === 'document-removed' ||
				type === 'document-imported'
			) {
				this.refreshState()
			}
		}
	}

	// ── Factory ──────────────────────────────────────────────────────────────

	static async open<
		GenericConfig extends AnyDialecteConfig,
		BaseExtensions extends ExtensionModules = Record<never, never>,
		CustomExtensions extends ExtensionModules = Record<never, never>,
	>(
		params: ProjectOpenParams<GenericConfig, BaseExtensions, CustomExtensions>,
	): Promise<Project<GenericConfig, MergedExtensions<BaseExtensions & CustomExtensions>>> {
		const { name, configs, storage, extensions, hooks, defaultConfigKey } = params
		const merged = mergeExtensions({ base: extensions?.base, custom: extensions?.custom })

		const configKeys = Object.keys(configs)
		const resolvedDefaultKey = defaultConfigKey ?? configKeys[0]

		const store = resolveStore(name, storage, configs[resolvedDefaultKey])
		await store.open()

		const project = new Project<GenericConfig, MergedExtensions<BaseExtensions & CustomExtensions>>(
			name,
			store,
			configs,
			resolvedDefaultKey,
			merged,
			hooks,
		)

		// Hydrate state from existing files in store
		const files = await store.getDocuments()
		for (const file of files) {
			project.state.documents.set(file.id, buildDocumentState(file))
		}

		return project
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
		this.channel.postMessage({ type: 'document-created', documentId: result.documentId })

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

	// ── Lifecycle ────────────────────────────────────────────────────────────

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

	// ── Internal ─────────────────────────────────────────────────────────────

	/** Access the underlying store (for import pipelines, testing) */
	getStore(): Store {
		return this.store
	}

	private async refreshState(): Promise<void> {
		const files = await this.store.getDocuments()
		reconcileDocumentState(this.state.documents, files)
	}
}
