import { SqliteEngine } from './sqlite-engine'

import * as Comlink from 'comlink'

import type { ChangeLogEntry, RecordSchema, Store } from '../store.types'
import type { SqliteEngineApi, SqliteStoreOptions } from './sqlite-engine.types'
import type { DocumentRecord } from '@/project/types'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	BlobAttachment,
	BlobRecord,
	RecordPatch,
} from '@/types'

/**
 * SqliteStore — main-thread `Store` backed by the worker-owned `SqliteEngine`
 * (SQLite WASM on OPFS `opfs-sahpool`). Every method delegates to the engine over
 * Comlink. In `memory` mode the engine runs in-process (no worker) for tests.
 *
 * The `commit` progress callback is passed across the worker via `Comlink.proxy`.
 * `getDatabaseInstance()` returns `null` — the DB lives in the worker.
 */
export class SqliteStore implements Store {
	readonly name: string
	private readonly recordSchema: RecordSchema
	private readonly mode: 'opfs-sahpool' | 'memory'
	private worker: Worker | null = null
	private remote: SqliteEngineApi | null = null

	constructor(name: string, options: SqliteStoreOptions) {
		this.name = name
		this.recordSchema = options.recordSchema
		this.mode = options.mode ?? 'opfs-sahpool'
	}

	private get engine(): SqliteEngineApi {
		if (!this.remote) throw new Error('SqliteStore not open — call open() first')
		return this.remote
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async open(): Promise<void> {
		if (this.remote) return

		if (this.mode === 'memory') {
			const engine = new SqliteEngine({ recordSchema: this.recordSchema })
			await engine.init({ kind: 'memory' })
			this.remote = engine
			return
		}

		this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' })
		const EngineProxy = Comlink.wrap<typeof SqliteEngine>(this.worker)
		// The Comlink worker proxy satisfies the same callable surface at runtime.
		const remote = (await new EngineProxy({
			recordSchema: this.recordSchema,
		})) as unknown as SqliteEngineApi
		await remote.init({ kind: 'opfs-sahpool', projectName: this.name })
		this.remote = remote
	}

	async close(): Promise<void> {
		await this.remote?.close()
		this.worker?.terminate()
		this.worker = null
		this.remote = null
	}

	async destroy(): Promise<void> {
		await this.engine.destroy()
		this.worker?.terminate()
		this.worker = null
		this.remote = null
	}

	// ── Cross-realm ──────────────────────────────────────────────────────────

	reconcile(documentId?: string): Promise<void> {
		return this.engine.reconcile(documentId)
	}

	isDocumentReadable(documentId: string): Promise<boolean> {
		return this.engine.isDocumentReadable(documentId)
	}

	// ── Registry ─────────────────────────────────────────────────────────────

	registerDocument(file: DocumentRecord): Promise<void> {
		return this.engine.registerDocument(file)
	}

	getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		return this.engine.getDocument(documentId)
	}

	getDocuments(): Promise<DocumentRecord[]> {
		return this.engine.getDocuments()
	}

	updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata'>>,
	): Promise<void> {
		return this.engine.updateDocument(documentId, updates)
	}

	removeDocument(documentId: string): Promise<void> {
		return this.engine.removeDocument(documentId)
	}

	// ── Records ──────────────────────────────────────────────────────────────

	get(id: string, documentId?: string): Promise<AnyRawRecord | undefined> {
		return this.engine.get(id, documentId)
	}

	getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		return this.engine.getByDocumentId(documentId)
	}

	getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		return this.engine.getByTagNameInDocument(tagName, documentId)
	}

	// ── Writes ───────────────────────────────────────────────────────────────

	beginImport(documentId: string): Promise<void> {
		return this.engine.beginImport(documentId)
	}

	finalizeImport(documentId: string): Promise<void> {
		return this.engine.finalizeImport(documentId)
	}

	/**
	 * Parse + persist a file inside the worker (no per-record Comlink clone). The
	 * document must already be registered. Returns the parsed record count.
	 */
	importDocument(
		documentId: string,
		file: File,
		config: AnyDialecteConfig,
		useCustomRecordsIds?: boolean,
	): Promise<number> {
		return this.engine.importDocument(documentId, file, config, useCustomRecordsIds)
	}

	bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		return this.engine.bulkWrite(documentId, ops)
	}

	commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		const { onProgress, ...rest } = params
		// The callback must cross the worker boundary as a proxied function.
		return this.engine.commit({ ...rest, onProgress: Comlink.proxy(onProgress) })
	}

	// ── History ──────────────────────────────────────────────────────────────

	undo(documentId: string): Promise<void> {
		return this.engine.undo(documentId)
	}

	redo(documentId: string): Promise<void> {
		return this.engine.redo(documentId)
	}

	getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		return this.engine.getHistoryStatus(documentId)
	}

	getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.engine.getChangeLog(documentId)
	}

	// ── Blobs ────────────────────────────────────────────────────────────────

	addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		return this.engine.addBlob(entry, data)
	}

	getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		return this.engine.getBlob(blobId)
	}

	getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.engine.getBlobsByDocument(documentId)
	}

	getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.engine.getBlobsByRecord(documentId, recordRef)
	}

	getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.engine.getStandaloneBlobs()
	}

	attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		return this.engine.attachBlob(blobId, ref)
	}

	detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		return this.engine.detachBlob(blobId, ref)
	}

	removeBlob(blobId: string): Promise<void> {
		return this.engine.removeBlob(blobId)
	}

	// The DB lives in the worker; nothing to hand out (see Store.getDatabaseInstance).
	getDatabaseInstance(): unknown {
		return null
	}
}
