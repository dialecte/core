import { resolveStore } from '../store/resolve-store'
import { exportBlob, exportDocument, initEmptyDocument } from './io'
import { resolveConfig } from './io/resolve-config'
import { projectChannelName } from './project-channel'
import { CLOSE_WAIT_REPORT_MS } from './project.constants'
import { buildDocumentState, reconcileDocumentState } from './state'
import { isImporting, openableDocuments } from './state/document-lifecycle'

import { Document } from '@/document'
import { createDialecteError, throwDialecteError, toDialecteError } from '@/errors'
import { mergeExtensions } from '@/helpers'
import { createPerf } from '@/perf'
import { createRunningOperations } from '@/store/running-operations'
import { invariant } from '@/utils'

import type {
	InitEmptyDocumentOptions,
	ImportDocumentOptions,
	ImportFilesOptions,
	ImportedDocument,
	ImportEntry,
	ProjectExportParams,
	ProjectExportResult,
	ProjectExportResultMaybeDocument,
	ProjectExportResultWithDocument,
	ProjectExportBlobParams,
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
	/** The store of the project last opened: open, or closed once `closing`. */
	private _store?: GenericStore
	/** The store of an `open` it refused, closed again: kept only for `destroy()`, the reset of that project. */
	private refusedStore?: Store
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
	/**
	 * The dialecte the project belongs to (its declaration's `id`), when its factory said: with the name, which
	 * project a store holds. `undefined` for a Project made with no dialecte.
	 */
	readonly dialecteId: string | undefined
	private configs: Record<string, GenericConfig>
	private defaultConfigKey: string
	private mergedExtensions?: MergedExtensions<GenericModules>
	private hooks?: DialecteHooks<GenericConfig>
	/** Single project-lived dev perf helper; frozen no-op unless `dev.perf`. */
	readonly perf: Perf
	/** Whether `dev.perf` is on: the store then hands back the timings of each import it runs. */
	private readonly perfEnabled: boolean

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
	private enqueueImport<GenericResult>(params: {
		fileName: string
		work: () => Promise<GenericResult>
	}): Promise<GenericResult> {
		const { fileName, work } = params
		const queued = this.importChain.then(work, work)
		this.importChain = queued
		// one entry per import, so two of one file name are both told
		const inFlight = { fileName }
		this.importsInFlight.add(inFlight)
		const importsInFlight = this.importsInFlight
		function settleImportInFlight(): void {
			importsInFlight.delete(inFlight)
		}
		void queued.then(settleImportInFlight, settleImportInFlight)
		return queued
	}

	/** The imports queued and not settled yet, the one running included: what a close says it waits for. */
	private readonly importsInFlight = new Set<{ fileName: string }>()

	/**
	 * The Project's `open`, `close` and `destroy`, one at a time in the order called: each runs once the one
	 * called before it has settled, however it settled.
	 */
	private lifecycle: Promise<unknown> = Promise.resolve()

	/** How many times a project was opened in this Project: what a batch import or a Document belongs to. */
	private opens = 0

	/** How many opens, closes and destroys are called and not settled yet, the one running included. */
	private lifecycleTurns = 0

	/** Run `work` in its turn among the Project's opens, closes and destroys. */
	private inLifecycleTurn<GenericResult>(
		work: () => Promise<GenericResult>,
	): Promise<GenericResult> {
		this.lifecycleTurns += 1
		const turn = this.lifecycle.then(work, work).finally(() => {
			this.lifecycleTurns -= 1
		})
		this.lifecycle = turn
		return turn
	}

	/**
	 * The writes of the open project running (a document made or removed, an undo, a redo, a blob's
	 * change): the whole close waits for them, as for the imports, before it closes the store.
	 */
	private readonly writes = createRunningOperations()

	/** A write of the open project counted in `writes` until the function answered is called (once). */
	private startCountedWrite(): () => void {
		const writes = this.writes
		writes.start()
		let ended = false
		return function endCountedWrite() {
			if (ended) return
			ended = true
			writes.end()
		}
	}

	/** Run a write of the open project, counted in `writes`; it reads the store at the call. */
	private async counted<GenericResult>(work: () => Promise<GenericResult>): Promise<GenericResult> {
		this.writes.start()
		try {
			return await work()
		} finally {
			this.writes.end()
		}
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
		return projectChannelName({ name: this.name })
	}

	/**
	 * Convenience: a fresh BroadcastChannel on this project's channel.
	 * The caller owns it — call channel.close() when done listening.
	 *
	 * @intent listen to project events, receive commits and imports made in other tabs
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
		dialecteId?: ProjectParams<GenericConfig>['dialecteId']
	}) {
		const configKeys = Object.keys(params.configs)
		this.dialecteId = params.dialecteId

		this.storage = params.storage
		this.configs = params.configs
		this.defaultConfigKey = params.defaultConfigKey ?? configKeys[0]
		this.hooks = params.hooks
		this.perfEnabled = params.dev?.perf ?? false
		this.perf = createPerf({ enabled: this.perfEnabled })
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
	 *
	 * Runs in turn with the Project's other `open`, `close` and `destroy` calls. On a Project already open -
	 * on another project or on the same one - it first closes it as `close()` does, and a call made from the
	 * `open` call on is refused until the last `open`, `close` or `destroy` called has settled; a Document of that
	 * open answers `STORE_CLOSED` when the store is made for each open (`local`, `inMemory`) - a `custom` store is
	 * the same one opened again: open the Documents again. An open whose store refuses, or whose documents cannot
	 * be read, leaves the Project closed; `destroy()` on it still removes that project (the reset of
	 * `PROJECT_DATABASE_LOST`), then `open` makes it again, empty.
	 *
	 * Never await `open`, `close` or `destroy` inside a hook or a transaction callback: the close waits for that
	 * work, which waits for the close (after 10 seconds the console says what it waits for).
	 *
	 * @intent open or create a project database, start working on a project, reopen a project after close
	 */
	async open(name: string): Promise<this> {
		// a project open now is closed first: a call made from now on is refused, as after close()
		if (this._channel !== undefined) this.closing = true
		return this.inLifecycleTurn(() => this.openNow({ name }))
	}

	private async openNow(params: { name: string }): Promise<this> {
		const { name } = params
		await this.closeNow()
		this._store = undefined
		this.refusedStore = undefined
		this._name = name
		let store: Store | undefined
		let channel: BroadcastChannel | undefined
		try {
			store = this.resolveProjectStore({ name })
			channel = new BroadcastChannel(this.channelName)
			channel.addEventListener('message', (event: MessageEvent<ProjectChannelMessage>) => {
				this.onChannelMessage(event.data)
			})
			// The store removes, as it opens, any import left unfinished.
			await store.open()
		} catch (thrown) {
			// what this open opened is closed again; its store is kept only for destroy()
			channel?.close()
			this.refusedStore = store
			await closeRefusedStore({ store })
			throw thrown
		}
		this._channel = channel
		this._store = store as GenericStore
		this.opens += 1
		// open from now on - unless a close, a destroy or another open was called after this one
		this.closing = this.lifecycleTurns > 1

		try {
			// A document still `importing` is an import in progress elsewhere: not opened.
			const files = openableDocuments(await store.getDocuments())
			for (const file of files) {
				this.state.documents.set(file.id, buildDocumentState(file))
			}
			await Promise.all(files.map((file) => this.refreshHistoryStatus(file.id)))
		} catch (thrown) {
			// what this open made is closed again, as for a store that refused to open
			this.closing = true
			channel!.close()
			this._channel = undefined
			this._store = undefined
			this.state.documents.clear()
			this.refusedStore = store
			await closeRefusedStore({ store })
			throw thrown
		}

		return this
	}

	/** The store of the project named, resolved from the storage option and never opened here. */
	private resolveProjectStore(params: { name: string }): Store {
		return resolveStore({
			name: params.name,
			dialecteId: this.dialecteId,
			storage: this.storage,
			runtime: {
				configs: this.configs,
				defaultConfigKey: this.defaultConfigKey,
				// Erase to the config-agnostic pipeline shape at this single core-internal boundary
				// (the import pipeline is registry-driven).
				hooks: this.hooks as DialecteHooks<AnyDialecteConfig> | undefined,
				perf: this.perfEnabled,
			},
			perf: this.perf,
		})
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
	 * Close the store and release resources, once the imports in flight (running and queued), the project's
	 * writes running (a Document's transaction or prepared commit included) and the work other realms' messages
	 * started have settled. Then the channel and the store
	 * are closed, `state.documents` is emptied and the Documents' subscriptions are dropped. From the call on,
	 * the project is closed: a new call throws `PROJECT_NOT_OPENED`, a Document opened before answers
	 * `STORE_CLOSED` (on a `custom` store opened again it writes but tells nothing: open it again). The stored documents stay.
	 * Runs in turn with the Project's other `open`, `close` and `destroy` calls.
	 *
	 * Never await it inside a hook or a transaction callback: the close waits for that work, which waits for it.
	 * An import whose dialecte hook never settles keeps it waiting too (nothing aborts a hook): after
	 * `CLOSE_WAIT_REPORT_MS` the console names the files of the imports it waits for.
	 *
	 * @intent close a project, release the database connection when leaving a page
	 */
	async close(): Promise<void> {
		// a call made from now on is refused, though the close waits for its turn
		this.closing = true
		return this.inLifecycleTurn(() => this.closeNow())
	}

	/** The whole close of an open project (the channel is there only while one is); nothing when none is open. */
	private async closeNow(): Promise<void> {
		this.closing = true
		if (this._channel === undefined) return
		// a close waiting long is told once: never a write lost by giving up the wait
		const report = setTimeout(() => this.reportCloseWait(), CLOSE_WAIT_REPORT_MS)
		try {
			await this.settledImports()
			await this.writes.whenIdle()
			// Wait for any in-flight foreign-message work to settle on the live store
			// before closing it, so no read/reconcile outlives it.
			await Promise.allSettled(this.pendingBroadcastWork)
			this._channel?.close()
			this._channel = undefined
			// settled once the store counts no more (its hub, or another tab, told)
			await this._store?.close()
		} finally {
			clearTimeout(report)
		}
		this.state.documents.clear()
		// the Documents of this open are told nothing more
		this.stateSubscribers.clear()
	}

	/**
	 * What a close still waits for, told once on the console - the files of the imports by name: a close that
	 * never ends is an import whose dialecte hook never settles, or a call awaited inside the work it waits for.
	 */
	private reportCloseWait(): void {
		const imports = [...this.importsInFlight].map(function quoted({ fileName }) {
			return `"${fileName}"`
		})
		const importsTold =
			imports.length === 0
				? '0 import(s)'
				: `${imports.length} import(s) (${imports.join(', ')}: an import hook that never settles keeps it waiting)`
		console.warn(
			`Project "${this._name}" has waited ${CLOSE_WAIT_REPORT_MS} ms to close for ${importsTold}, ${this.writes.count} write(s) and ${this.pendingBroadcastWork.size} other-tab update(s) in flight, then its store's close; it goes on waiting. If it never ends, a hook or a transaction callback is awaiting this Project's open, close or destroy.`,
		)
	}

	/**
	 * Destroy the project - deletes the database entirely, every document with its history and blobs,
	 * once the imports in flight have landed; refused `PROJECT_OPEN_ELSEWHERE`, nothing removed, while another
	 * connection - a project or store of the name, in this page or another tab - has it open. To delete one
	 * document, use `removeDocument`.
	 *
	 * The project destroyed is the one this Project last opened, or the one whose `open` its store refused
	 * (`PROJECT_DATABASE_LOST`): that store is not opened again, and `open` then makes the project again, empty.
	 * Refused, the project is closed all the same, as by `close()`: a `destroy()` called again once the other
	 * connection closed removes it.
	 * Runs in turn with the Project's other `open`, `close` and `destroy` calls.
	 *
	 * Never await it inside a hook or a transaction callback: the close waits for that work, which waits for it.
	 *
	 * @intent delete a whole project, wipe the project database with every document
	 */
	async destroy(): Promise<void> {
		// a call made from now on is refused, though the destroy waits for its turn
		this.closing = true
		return this.inLifecycleTurn(() => this.destroyNow())
	}

	private async destroyNow(): Promise<void> {
		// the project this destroy is for, taken before anything else is awaited
		const store = this._store ?? this.refusedStore
		await this.closeNow()
		await store?.destroy()
		this._store = undefined
		this.refusedStore = undefined
	}

	// ── File management ──────────────────────────────────────────────────────

	/**
	 * Register a new empty document in the project.
	 * Returns the new documentId. Records are added later via import or transactions.
	 *
	 * @intent create a new empty document, start a document from scratch without a file
	 */
	async initEmptyDocument(options?: InitEmptyDocumentOptions): Promise<string> {
		return this.counted(async () => {
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
		})
	}

	/**
	 * Remove one document from the project - its records, history and blobs - and tell other tabs. The
	 * other documents stay.
	 *
	 * @intent delete a document from the project, remove one file and its records
	 */
	async removeDocument(documentId: string): Promise<void> {
		return this.counted(async () => {
			await this.store.removeDocument(documentId)
			this.state.documents.delete(documentId)
			this.broadcast({ type: 'document-removed', documentId, timestamp: Date.now() })
		})
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
	 * `configKey`, a project not open, a `path` (`DOCUMENT_PATH_INVALID`: a path names one file,
	 * `importFile` takes it).
	 *
	 * @intent import several XML files at once, get one result per file without a throw for a failed file
	 */
	async import(files: File[], options?: ImportFilesOptions): Promise<ImportEntry[]> {
		this.importStore(options)
		refuseBatchPath({ options })
		// the batch is for the project open now: a file whose turn comes once it closed is refused, never
		// imported into a project opened since
		const opened = this.opens

		const entries: ImportEntry[] = []
		for (const file of files) {
			try {
				this.refuseClosedOpen({ opened })
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
	 * Import one File into the project: the store registers, parses and stores it next to the data.
	 * The document is in the project state and broadcast once the store answers it `ready`; whatever
	 * fails before that, or an abort through `options.signal`, leaves nothing and is thrown
	 * (`PARSE_ERROR` for a malformed file, `IMPORT_ABORTED`, `IMPORT_FAILED` wrapping a foreign
	 * error). `options.onProgress` is told after each stored batch, never awaited. One file is in
	 * flight per project: a call made while another import runs waits for it.
	 *
	 * @intent import an XML file, load a file into the project, parse XML into records
	 */
	async importFile(file: File, options?: ImportDocumentOptions): Promise<ImportedDocument> {
		const store = this.importStore(options)
		return this.enqueueImport({
			fileName: file.name,
			work: () => this.importOne({ file, options, store }),
		})
	}

	private async importOne(params: {
		file: File
		options?: ImportDocumentOptions
		store: GenericStore
	}): Promise<ImportedDocument> {
		const { file, options = {}, store } = params
		const { onProgress, signal, ...fileOptions } = options
		const result = await store.importFile({ file, options: fileOptions, onProgress, signal })
		if (result.perf) this.perf.merge({ report: result.perf, prefix: 'store' })
		this.state.documents.set(result.record.id, buildDocumentState(result.record))
		this.broadcast({
			type: 'document-imported',
			documentId: result.record.id,
			timestamp: Date.now(),
		})
		return {
			fileName: file.name,
			documentId: result.record.id,
			recordCount: result.recordCount,
			diagnostics: result.diagnostics,
		}
	}

	/**
	 * Export a document through the store: its file (`Blob`, formatted unless `indent: false`) and filename. On the
	 * page, `xmlDocument: true` also answers its DOM (parsed from the compact file: pass `indent: false` to export
	 * once) and `download` saves the formatted file (the save dialog is asked first). Two store exports made for one
	 * call may see two states of the document if a commit lands between them.
	 *
	 * @intent export a document to an XML file, get a document as a Blob, download a document, save a document as XML, read the exported XML as a DOM
	 */
	async export(
		params: ProjectExportParams & { xmlDocument: true },
	): Promise<ProjectExportResultWithDocument>
	async export(params: ProjectExportParams & { xmlDocument?: false }): Promise<ProjectExportResult>
	async export(params: ProjectExportParams): Promise<ProjectExportResultMaybeDocument>
	async export(params: ProjectExportParams): Promise<ProjectExportResultMaybeDocument> {
		return exportDocument({
			store: this.store,
			state: this.state,
			projectName: this.name,
			request: params,
			perf: this.perf,
		})
	}

	// ── File registry ────────────────────────────────────────────────────────

	/**
	 * The documents of the project; one still importing - here or in another realm - is not among them.
	 *
	 * @intent list the documents of a project, show the files a project holds
	 */
	async getDocuments(): Promise<DocumentRecord[]> {
		return openableDocuments(await this.store.getDocuments())
	}

	/**
	 * The metadata record of one document of the project, or `undefined` when it is unknown or still importing.
	 *
	 * @intent check a document exists, read a document's name or config key by id
	 */
	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		const record = await this.store.getDocument(documentId)
		return record && !isImporting(record) ? record : undefined
	}

	// ── Document access ──────────────────────────────────────────────────────

	/**
	 * Open a file-scoped Document for querying and mutating a specific file.
	 *
	 * @intent open a document to read or write it, get the Document of an id
	 */
	openDocument(documentId: string): Document<GenericConfig, MergedExtensions<GenericModules>> {
		// a closed project answers so first: its state is emptied as it closes
		const store = this.store
		const documentState = this.state.documents.get(documentId)

		invariant(documentState, {
			key: 'DOCUMENT_NOT_REGISTERED',
			detail: `Document "${documentId}" not registered in project "${this.name}"`,
		})

		const config = this.configs[documentState.record.configKey]
		// the Document belongs to this open: once it closed, what it tells reaches no later open
		const opened = this.opens
		return new Document(store, config, documentId, this.mergedExtensions, this.hooks, {
			// Shared with project state: every Document instance for this
			// documentId mutates the same entry the Project (and its channel
			// fold) maintains.
			state: documentState,
			channelName: this.channelName,
			broadcast: (message) => {
				if (this.isCurrentOpen({ opened })) this.broadcast(message)
			},
			// Lets a local commit refresh canUndo/canRedo on the shared entry
			// synchronously, without a channel round-trip.
			refreshHistoryStatus: async () => {
				if (this.isCurrentOpen({ opened })) await this.refreshHistoryStatus(documentId)
			},
			perf: this.perf,
			subscribeState: (callback) =>
				this.isCurrentOpen({ opened })
					? this.subscribeState(documentId, callback)
					: unsubscribeNothing,
			signalStateChange: (terminal) => {
				if (this.isCurrentOpen({ opened })) this.signalStateChange(documentId, terminal)
			},
			// a commit of this open is waited for by its close; one of an open that closed writes to its closed store
			startWrite: () => {
				if (!this.isCurrentOpen({ opened })) return endNothing
				// refused while this open closes, as the Project's own writes are
				this.refuseClosedOpen({ opened })
				return this.startCountedWrite()
			},
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
	 *
	 * @intent check that a document imported in another tab can be opened, wait for a document from another realm
	 */
	async getDocumentStatus(documentId: string): Promise<{ live: boolean; ready: boolean }> {
		await this.store.reconcile(documentId)
		await this.refreshState()
		const live = this.state.documents.has(documentId)
		const ready = live && (await this.store.isDocumentReadable(documentId))
		return { live, ready }
	}

	/**
	 * Get the dialecte config a document uses, or `undefined` for a document the project does not know.
	 *
	 * @intent get the dialecte config of a document, know which schema a document uses
	 */
	getDocumentConfig(documentId: string): GenericConfig | undefined {
		const documentState = this.state.documents.get(documentId)
		if (!documentState) return undefined
		return this.configs[documentState.record.configKey]
	}

	// ── Undo / Redo ──────────────────────────────────────────────────────────

	/**
	 * Revert the last committed transaction of a document and tell other tabs. Does nothing when there is nothing to undo.
	 *
	 * @intent undo the last change to a document, roll back a commit
	 */
	async undo(documentId: string): Promise<void> {
		return this.counted(async () => {
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
		})
	}

	/**
	 * Re-apply the last undone transaction of a document and tell other tabs. Does nothing when there is nothing to redo.
	 *
	 * @intent redo an undone change to a document
	 */
	async redo(documentId: string): Promise<void> {
		return this.counted(async () => {
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
		})
	}

	// ── Blobs ────────────────────────────────────────────────────────────────

	/**
	 * Add a blob owned by `documentId`. The binary lives in `blob_{documentId}`.
	 * Returns the generated blob id.
	 *
	 * @intent store a binary file in the project, add an attachment owned by a document
	 */
	async addBlob(
		documentId: string,
		file: File,
		attachedTo: BlobAttachment[] = [],
	): Promise<string> {
		return this.counted(async () => {
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
		})
	}

	/**
	 * Read a stored blob: its metadata entry and its binary data, or `undefined` when the id is unknown.
	 *
	 * @intent read an attached file's content, load a blob by id
	 */
	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.store.getBlob(blobId)
	}

	/**
	 * Export a blob from the store: `{ entry, data, filename }`; `download` also saves it (the save dialog, or a
	 * browser download), under its name or the one given.
	 *
	 * @intent download a stored file, save a blob to disk, read a blob with its file name
	 */
	async exportBlob(params: ProjectExportBlobParams): Promise<ExportBlobResult> {
		return exportBlob({ store: this.store, request: params })
	}

	/**
	 * The blobs referenced from a document (any of their attachments points into it).
	 *
	 * @intent list the files attached to a document
	 */
	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.store.getBlobsByDocument(documentId)
	}

	/**
	 * The blobs referenced from one element of a document.
	 *
	 * @intent list the files attached to one element
	 */
	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.store.getBlobsByRecord(documentId, recordRef)
	}

	/**
	 * The blobs of the project that no document references (no attachment).
	 *
	 * @intent list unattached files, find orphan blobs to clean up
	 */
	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.store.getStandaloneBlobs()
	}

	/**
	 * Reference an existing blob from an element of a document (optionally from one of its attributes) and tell other tabs.
	 *
	 * @intent link a stored file to an element, attach a blob to a record
	 */
	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		return this.counted(async () => {
			await this.store.attachBlob(blobId, ref)
			this.broadcast({ type: 'blob-attached', blobId, ref, timestamp: Date.now() })
		})
	}

	/**
	 * Drop the reference from an element of a document to a blob; the blob itself stays stored.
	 *
	 * @intent unlink a file from an element, detach a blob from a record
	 */
	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		return this.counted(async () => {
			await this.store.detachBlob(blobId, ref)
			this.broadcast({ type: 'blob-detached', blobId, ref, timestamp: Date.now() })
		})
	}

	/**
	 * Delete a blob and its binary data from the project and tell other tabs. Does nothing when the id is unknown.
	 *
	 * @intent delete a stored file, remove a blob for good
	 */
	async removeBlob(blobId: string): Promise<void> {
		return this.counted(async () => {
			await this.store.removeBlob(blobId)
			this.broadcast({ type: 'blob-removed', blobId, timestamp: Date.now() })
		})
	}

	// ── Cross-document queries ───────────────────────────────────────────────

	/**
	 * Run a query function across all documents, return the first non-undefined result.
	 * Iterates documents sequentially; stops at the first match.
	 *
	 * @intent find the first match across every document, search all documents of a project
	 */
	async queryFirst<Result>(
		queryFunction: (
			query: Query<GenericConfig> & QueryExtensions<MergedExtensions<GenericModules>>,
		) => Promise<Result | undefined>,
	): Promise<Result | undefined> {
		let found: Result | undefined
		await this.visitOpenDocuments({
			visit: async (doc) => {
				found = await queryFunction(doc.query)
				return found !== undefined
			},
		})
		return found
	}

	/**
	 * Run a query function across all documents, collect and flatten results.
	 * Iterates documents sequentially; merges all non-empty arrays.
	 *
	 * @intent collect results from every document, run one query over all documents
	 */
	async queryAll<Result>(
		queryFunction: (
			query: Query<GenericConfig> & QueryExtensions<MergedExtensions<GenericModules>>,
		) => Promise<Result[]>,
	): Promise<Result[]> {
		const results: Result[] = []
		await this.visitOpenDocuments({
			visit: async (doc) => {
				results.push(...(await queryFunction(doc.query)))
				return false
			},
		})
		return results
	}

	/**
	 * Visit each document of the open project in turn, until `visit` answers `true`: the ids taken at the call, a
	 * document removed meanwhile skipped; refused `PROJECT_NOT_OPENED` once that open closes or another one opens,
	 * never a partial answer or one mixing two opens.
	 */
	private async visitOpenDocuments(params: {
		visit: (doc: Document<GenericConfig, MergedExtensions<GenericModules>>) => Promise<boolean>
	}): Promise<void> {
		// a project not open answers so, not with an empty answer
		void this.store
		const opened = this.opens
		// the ids taken now: closing empties the map, an open refills it
		for (const documentId of Array.from(this.state.documents.keys())) {
			this.refuseClosedOpen({ opened })
			if (!this.state.documents.has(documentId)) continue
			const done = await params.visit(this.openDocument(documentId))
			this.refuseClosedOpen({ opened })
			if (done) return
		}
	}

	/** Whether the open a Document was made in is still the open one, its channel there. */
	private isCurrentOpen(params: { opened: number }): boolean {
		return this.opens === params.opened && this._channel !== undefined
	}

	/** `PROJECT_NOT_OPENED` once the open a call was made in has closed, or another one opened. */
	private refuseClosedOpen(params: { opened: number }): void {
		invariant(this.opens === params.opened && !this.closing, {
			key: 'PROJECT_NOT_OPENED',
			detail: 'The project was closed, or another one opened, while this call ran: open it again.',
		})
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	/**
	 * Expose the underlying database instance. Return type is inferred from the store (Dexie for local storage).
	 *
	 * @intent inspect the underlying database, debug what the store holds
	 */
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

/** A path handed to an import of several files, refused for the call: a path names one file. */
function refuseBatchPath(params: { options: ImportFilesOptions | undefined }): void {
	const { options } = params
	if (options && 'path' in options && options.path !== undefined) {
		throwDialecteError('DOCUMENT_PATH_INVALID', {
			detail:
				'An import of several files takes no path: a path names one file, give it to importFile',
			meta: { path: options.path },
		})
	}
}

/** A refused open's store closed again: its own failure to close is not the open's answer, which is the refusal. */
async function closeRefusedStore(params: { store: Store | undefined }): Promise<void> {
	try {
		await params.store?.close()
	} catch {
		// the refusal is what the caller is told; the store is destroyed or opened again from here
	}
}

/** The unsubscribe of a subscription never made: a Document of an open that closed is told nothing. */
function unsubscribeNothing(): void {}

/** The end of a write never counted: a Document of an open that closed. */
function endNothing(): void {}
