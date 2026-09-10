import { recordTableName } from '../store.constants'
import { recordIndexDDL, recordTableDDL } from './sqlite-schema'
import { indexBuildCacheSizeKiB, pageCacheSizeKiB } from './sqlite-tuning'

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

import { throwDialecteError } from '@/errors'
import { parseXmlFile } from '@/xml'

import type { ChangeLogEntry, RecordSchema, Store } from '../store.types'
import type {
	Sqlite3Static,
	SqlBindable,
	SqliteDb,
	SqliteEngineApi,
	SqliteEngineMode,
	SqliteEngineOptions,
	SqliteSahPool,
	SqlValue,
} from './sqlite-engine.types'
import type { DocumentRecord } from '@/project/types'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	BlobAttachment,
	BlobRecord,
	RecordPatch,
} from '@/types'

const RECORD_INSERT_COLUMNS = 'id,tagName,nsPrefix,nsUri,value,parentId,parentTagName,attributes'
const RECORD_PLACEHOLDERS = '?,?,?,?,?,?,?,?'

type ChangeLogOperations = ChangeLogEntry['operations']

/**
 * SqliteEngine — the SQL-backed Store implementation that runs inside the OPFS
 * worker (or, in `memory` mode, directly for tests). Mirrors InMemoryStore /
 * DexieStore semantics. One record table (`xel_<documentId>`) per document.
 *
 * Import model: `beginImport`/`finalizeImport` wrap a whole document import in one
 * transaction. Because `project.import` runs files via `Promise.all` on a single
 * SQLite connection (one transaction per connection), import sessions are
 * serialized by an internal mutex — the second `beginImport` waits for the first
 * `finalizeImport`.
 */
export class SqliteEngine implements SqliteEngineApi {
	private db: SqliteDb | null = null
	private pool: SqliteSahPool | null = null
	// Steady-state page cache (negative KiB), 0 in memory mode. Bumped transiently for the
	// finalize-time index build.
	private cacheKiB = 0
	private readonly recordSchema: RecordSchema
	// Import mutex: the tail of the queue of in-flight import sessions.
	private importQueueTail: Promise<void> = Promise.resolve()
	private releaseImport: (() => void) | null = null

	constructor(options: SqliteEngineOptions) {
		this.recordSchema = options.recordSchema
	}

	private get database(): SqliteDb {
		if (!this.db) throw new Error('SqliteEngine not initialized — call init() first')
		return this.db
	}

	private get importActive(): boolean {
		return this.releaseImport !== null
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async init(mode: SqliteEngineMode): Promise<void> {
		const sqlite3 = (await sqlite3InitModule()) as unknown as Sqlite3Static
		if (mode.kind === 'memory') {
			this.db = new sqlite3.oo1.DB(':memory:', 'c')
		} else {
			const pool = await sqlite3.installOpfsSAHPoolVfs({ name: `dialecte-${mode.projectName}` })
			this.pool = pool
			this.db = new pool.OpfsSAHPoolDb(`/${mode.projectName}.sqlite3`)
			// Device-sized page cache (negative KiB). With deferred indexes this keeps a bulk
			// import linear without reserving a fixed slice of RAM on low-memory devices;
			// temp_store=MEMORY keeps the finalize-time index build off OPFS.
			this.cacheKiB = pageCacheSizeKiB(deviceMemoryGiB())
			this.db.exec(
				`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA locking_mode=EXCLUSIVE; PRAGMA cache_size=-${this.cacheKiB};`,
			)
		}
		this.createSystemTables()
	}

	async close(): Promise<void> {
		this.db?.close()
		this.db = null
		// Release the sahpool's SyncAccessHandles so a later open of the same project
		// does not deadlock on orphaned locks.
		await this.pool?.removeVfs()
		this.pool = null
	}

	async destroy(): Promise<void> {
		// Drop every table; the file itself is removed by the worker/pool if needed.
		// `sqlite_%` are SQLite-internal tables (e.g. sqlite_sequence) that cannot be dropped.
		const tables = this.query<{ name: SqlValue }>(
			`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
		)
		for (const { name } of tables) {
			if (typeof name === 'string') this.database.exec(`DROP TABLE IF EXISTS "${name}"`)
		}
		this.createSystemTables()
		// Reclaim the OPFS bytes this project held; dropping tables alone leaves the
		// sahpool file allocated, so a deleted project would otherwise leak its quota.
		if (this.pool) {
			this.db?.close()
			this.db = null
			await this.pool.wipeFiles()
			await this.pool.removeVfs()
			this.pool = null
		}
	}

	// ── Cross-realm ──────────────────────────────────────────────────────────

	// Single owning connection: it always sees its own committed state. Cross-tab
	// coordination is handled above the store (BroadcastChannel + sahpool locking).
	async reconcile(_documentId?: string): Promise<void> {}

	async isDocumentReadable(documentId: string): Promise<boolean> {
		return this.hasTable(recordTableName(documentId))
	}

	// ── Registry ─────────────────────────────────────────────────────────────

	async registerDocument(file: DocumentRecord): Promise<void> {
		const table = recordTableName(file.id)
		// Create the table WITHOUT secondary indexes: inserting into an unindexed table keeps
		// a bulk import sequential. The indexes are built once in finalizeImport / commit.
		this.database.exec(recordTableDDL(table))
		this.database.exec({
			sql: 'INSERT OR REPLACE INTO _documents (id,name,extension,configKey,createdAt,metadata) VALUES (?,?,?,?,?,?)',
			bind: [
				file.id,
				file.name,
				file.extension,
				file.configKey,
				file.createdAt,
				file.metadata ? JSON.stringify(file.metadata) : null,
			],
		})
	}

	/** The named secondary indexes on a document's record table (excludes the PK autoindex). */
	async listRecordIndexes(documentId: string): Promise<string[]> {
		const table = recordTableName(documentId)
		return this.query<{ name: SqlValue }>(
			`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name LIKE 'idx_%'`,
			[table],
		).map((row) => String(row.name))
	}

	/** Build the deferred secondary indexes for a record table (idempotent). */
	private ensureRecordIndexes(table: string): void {
		const stmts = recordIndexDDL(table, this.recordSchema)
		if (stmts.length === 0) return
		// A one-shot index build over a large table spills to OPFS under the steady-state
		// cache; bump it for the build, then restore. No-op in memory mode (cacheKiB=0).
		const buildKiB = indexBuildCacheSizeKiB(this.cacheKiB)
		if (buildKiB > 0) this.database.exec(`PRAGMA cache_size=-${buildKiB};`)
		try {
			for (const stmt of stmts) this.database.exec(stmt)
		} finally {
			if (buildKiB > 0) this.database.exec(`PRAGMA cache_size=-${this.cacheKiB};`)
		}
	}

	async getDocument(documentId: string): Promise<DocumentRecord | undefined> {
		const rows = this.query('SELECT * FROM _documents WHERE id=?', [documentId])
		return rows[0] ? rowToDocument(rows[0]) : undefined
	}

	async getDocuments(): Promise<DocumentRecord[]> {
		return this.query('SELECT * FROM _documents').map(rowToDocument)
	}

	async updateDocument(
		documentId: string,
		updates: Partial<Pick<DocumentRecord, 'name' | 'metadata'>>,
	): Promise<void> {
		const existing = await this.getDocument(documentId)
		if (!existing) return
		const merged = { ...existing, ...updates }
		this.database.exec({
			sql: 'UPDATE _documents SET name=?, metadata=? WHERE id=?',
			bind: [merged.name, merged.metadata ? JSON.stringify(merged.metadata) : null, documentId],
		})
	}

	async removeDocument(documentId: string): Promise<void> {
		this.database.exec(`DROP TABLE IF EXISTS "${recordTableName(documentId)}"`)
		this.database.exec({ sql: 'DELETE FROM _documents WHERE id=?', bind: [documentId] })
		this.database.exec({ sql: 'DELETE FROM _changeLog WHERE documentId=?', bind: [documentId] })
		this.database.exec({ sql: 'DELETE FROM _meta WHERE key=?', bind: [`head:${documentId}`] })
	}

	// ── Record access ────────────────────────────────────────────────────────

	async get(id: string, documentId?: string): Promise<AnyRawRecord | undefined> {
		if (documentId) {
			const table = recordTableName(documentId)
			const rows = this.query(`SELECT * FROM "${table}" WHERE id=?`, [id])
			if (!rows[0]) return undefined
			const record = rowToRecord(rows[0])
			record.children = this.childrenOf(table, id)
			return record
		}
		for (const doc of await this.getDocuments()) {
			const table = recordTableName(doc.id)
			const rows = this.query(`SELECT * FROM "${table}" WHERE id=?`, [id])
			if (rows[0]) {
				const record = rowToRecord(rows[0])
				record.children = this.childrenOf(table, id)
				return record
			}
		}
		return undefined
	}

	async getByDocumentId(documentId: string): Promise<AnyRawRecord[]> {
		const records = this.query(`SELECT * FROM "${recordTableName(documentId)}"`).map(rowToRecord)
		return withDerivedChildren(records)
	}

	async getByTagNameInDocument(tagName: string, documentId: string): Promise<AnyRawRecord[]> {
		const table = recordTableName(documentId)
		const records = this.query(`SELECT * FROM "${table}" WHERE tagName=?`, [tagName]).map(
			rowToRecord,
		)
		for (const record of records) record.children = this.childrenOf(table, record.id)
		return records
	}

	/** Direct children of a record, derived from the `parentId` edge (no children column). */
	private childrenOf(table: string, parentId: string): AnyRawRecord['children'] {
		return this.query<{ id: SqlValue; tagName: SqlValue }>(
			`SELECT id,tagName FROM "${table}" WHERE parentId=?`,
			[parentId],
		).map((row) => ({ id: row.id as string, tagName: row.tagName as string }))
	}

	// ── Writes ───────────────────────────────────────────────────────────────

	async beginImport(_documentId?: string): Promise<void> {
		// Serialize import sessions on the single connection: wait for any active one.
		const previous = this.importQueueTail
		let release!: () => void
		this.importQueueTail = new Promise<void>((resolve) => (release = resolve))
		await previous
		this.releaseImport = release
		this.database.exec('BEGIN')
	}

	async finalizeImport(documentId?: string): Promise<void> {
		if (!this.importActive) return
		this.database.exec('COMMIT')
		const release = this.releaseImport
		this.releaseImport = null
		release?.()
		// Build the deferred secondary indexes once, over the fully-loaded table.
		if (documentId) this.ensureRecordIndexes(recordTableName(documentId))
	}

	/**
	 * Parse a file and persist it entirely within this engine's realm. In the OPFS
	 * worker this runs the SAX parser IN the worker against the in-worker store, so
	 * records never cross the Comlink boundary (no per-record structured clone). The
	 * document must already be registered. Returns the parsed record count.
	 */
	async importDocument(
		documentId: string,
		file: File,
		config: AnyDialecteConfig,
		useCustomRecordsIds?: boolean,
	): Promise<number> {
		await this.beginImport(documentId)
		try {
			const { recordCount } = await parseXmlFile({
				file,
				documentId,
				store: this as unknown as Store,
				config,
				useCustomRecordsIds,
			})
			await this.finalizeImport(documentId)
			return recordCount
		} catch (error) {
			await this.finalizeImport(documentId).catch(() => {})
			throw error
		}
	}

	async bulkWrite(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): Promise<void> {
		// When an import transaction is open, write directly into it; otherwise wrap
		// this call in its own transaction (parity with Dexie/InMemory atomicity).
		const ownTx = !this.importActive
		if (ownTx) this.database.exec('BEGIN')
		try {
			this.applyBulk(documentId, ops)
			if (ownTx) this.database.exec('COMMIT')
		} catch (error) {
			if (ownTx) this.database.exec('ROLLBACK')
			throw error
		}
	}

	private applyBulk(
		documentId: string,
		ops: { creates?: AnyRawRecord[]; updates?: RecordPatch[]; deletes?: string[] },
	): void {
		const table = recordTableName(documentId)

		if (ops.creates?.length) {
			const stmt = this.database.prepare(
				`INSERT OR REPLACE INTO "${table}" (${RECORD_INSERT_COLUMNS}) VALUES (${RECORD_PLACEHOLDERS})`,
			)
			try {
				for (const record of ops.creates) {
					stmt.bind(recordBindings(record))
					stmt.step()
					stmt.reset(true)
				}
			} finally {
				stmt.finalize()
			}
		}

		if (ops.updates?.length) {
			for (const { recordId, ...patch } of ops.updates) {
				const rows = this.query(`SELECT * FROM "${table}" WHERE id=?`, [recordId])
				if (!rows[0]) continue
				const merged = mergePatch(rowToRecord(rows[0]), patch)
				this.database.exec({
					sql: `INSERT OR REPLACE INTO "${table}" (${RECORD_INSERT_COLUMNS}) VALUES (${RECORD_PLACEHOLDERS})`,
					bind: recordBindings(merged),
				})
			}
		}

		if (ops.deletes?.length) {
			const stmt = this.database.prepare(`DELETE FROM "${table}" WHERE id=?`)
			try {
				for (const id of ops.deletes) {
					stmt.bind([id])
					stmt.step()
					stmt.reset(true)
				}
			} finally {
				stmt.finalize()
			}
		}
	}

	// ── Commit + history ─────────────────────────────────────────────────────

	async commit(params: {
		documentId: string
		creates: AnyRawRecord[]
		updates: AnyRawRecord[]
		deletes: string[]
		onProgress: (current: number, total: number) => void
	}): Promise<void> {
		const { documentId, creates, updates, deletes, onProgress } = params
		const table = recordTableName(documentId)
		// A document created empty and grown via commits never ran finalizeImport, so it has
		// no secondary indexes yet; ensure them here (no-op once built).
		this.ensureRecordIndexes(table)
		const total = creates.length + updates.length + deletes.length
		let completed = 0

		this.database.exec('BEGIN')
		try {
			const beforeSnapshots = updates.map((r) => this.getRecordRow(table, r.id))
			const deletedSnapshots = deletes
				.map((id) => this.getRecordRow(table, id))
				.filter((r): r is AnyRawRecord => r !== undefined)

			this.insertRecords(table, creates)
			completed += creates.length
			onProgress(completed, total)

			this.insertRecords(table, updates)
			completed += updates.length
			onProgress(completed, total)

			this.deleteRecords(table, deletes)
			completed += deletes.length
			onProgress(completed, total)

			const head = this.getHead(documentId)
			this.database.exec({
				sql: 'DELETE FROM _changeLog WHERE documentId=? AND sequenceNumber>?',
				bind: [documentId, head],
			})
			const newSeq = head + 1
			const operations = {
				creates,
				updates: updates.map((after, i) => ({ before: beforeSnapshots[i]!, after })),
				deletes: deletedSnapshots,
			}
			this.database.exec({
				sql: 'INSERT INTO _changeLog (documentId,sequenceNumber,timestamp,operations) VALUES (?,?,?,?)',
				bind: [documentId, newSeq, Date.now(), JSON.stringify(operations)],
			})
			this.setHead(documentId, newSeq)
			this.database.exec('COMMIT')
		} catch (error) {
			this.database.exec('ROLLBACK')
			throw error
		}
	}

	async undo(documentId: string): Promise<void> {
		const head = this.getHead(documentId)
		if (head === 0) return
		const ops = this.getChangeLogOperations(documentId, head)
		if (!ops) return
		const table = recordTableName(documentId)
		this.database.exec('BEGIN')
		try {
			this.deleteRecords(
				table,
				ops.creates.map((r) => r.id),
			)
			this.insertRecords(
				table,
				ops.updates.map((u) => u.before),
			)
			this.insertRecords(table, ops.deletes)
			this.setHead(documentId, head - 1)
			this.database.exec('COMMIT')
		} catch (error) {
			this.database.exec('ROLLBACK')
			throw error
		}
	}

	async redo(documentId: string): Promise<void> {
		const head = this.getHead(documentId)
		const next = head + 1
		const ops = this.getChangeLogOperations(documentId, next)
		if (!ops) return
		const table = recordTableName(documentId)
		this.database.exec('BEGIN')
		try {
			this.insertRecords(table, ops.creates)
			this.insertRecords(
				table,
				ops.updates.map((u) => u.after),
			)
			this.deleteRecords(
				table,
				ops.deletes.map((r) => r.id),
			)
			this.setHead(documentId, next)
			this.database.exec('COMMIT')
		} catch (error) {
			this.database.exec('ROLLBACK')
			throw error
		}
	}

	async getHistoryStatus(documentId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
		const head = this.getHead(documentId)
		const next = this.query('SELECT 1 FROM _changeLog WHERE documentId=? AND sequenceNumber=?', [
			documentId,
			head + 1,
		])
		return { canUndo: head > 0, canRedo: next.length > 0 }
	}

	async getChangeLog(documentId: string): Promise<ChangeLogEntry[]> {
		return this.query('SELECT * FROM _changeLog WHERE documentId=? ORDER BY sequenceNumber', [
			documentId,
		]).map((row) => ({
			id: row.id as number,
			documentId: row.documentId as string,
			sequenceNumber: row.sequenceNumber as number,
			timestamp: row.timestamp as number,
			operations: JSON.parse(row.operations as string),
		}))
	}

	// ── Blobs ────────────────────────────────────────────────────────────────

	async addBlob(entry: BlobRecord, data: Blob): Promise<void> {
		const bytes = new Uint8Array(await data.arrayBuffer())
		this.database.exec({
			sql: 'INSERT OR REPLACE INTO _blobs (id,documentId,entry,mime,data) VALUES (?,?,?,?,?)',
			bind: [entry.id, entry.documentId, JSON.stringify(entry), data.type, bytes],
		})
	}

	async getBlob(blobId: string): Promise<{ entry: BlobRecord; data: Blob } | undefined> {
		const rows = this.query('SELECT entry,mime,data FROM _blobs WHERE id=?', [blobId])
		if (!rows[0]) return undefined
		const bytes = rows[0].data as Uint8Array
		return {
			entry: JSON.parse(rows[0].entry as string),
			// Cast: sqlite returns a plain Uint8Array; the ArrayBufferLike generic
			// (SharedArrayBuffer branch) is irrelevant here but trips BlobPart.
			data: new Blob([bytes as unknown as BlobPart], { type: (rows[0].mime as string) ?? '' }),
		}
	}

	async getBlobsByDocument(documentId: string): Promise<BlobRecord[]> {
		return this.allBlobEntries().filter((b) =>
			b.attachedTo.some((a) => a.documentId === documentId),
		)
	}

	async getBlobsByRecord(documentId: string, recordRef: string): Promise<BlobRecord[]> {
		return this.allBlobEntries().filter((b) =>
			b.attachedTo.some((a) => a.documentId === documentId && a.recordRef === recordRef),
		)
	}

	async getStandaloneBlobs(): Promise<BlobRecord[]> {
		return this.allBlobEntries().filter((b) => b.attachedTo.length === 0)
	}

	async attachBlob(blobId: string, ref: BlobAttachment): Promise<void> {
		const entry = this.getBlobEntry(blobId)
		if (!entry) throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		const exists = entry.attachedTo.some(
			(a) =>
				a.documentId === ref.documentId &&
				a.recordRef === ref.recordRef &&
				a.attribute === ref.attribute,
		)
		if (exists) return
		this.updateBlobEntry({ ...entry, attachedTo: [...entry.attachedTo, ref] })
	}

	async detachBlob(blobId: string, ref: { documentId: string; recordRef: string }): Promise<void> {
		const entry = this.getBlobEntry(blobId)
		if (!entry) throwDialecteError('STORE_BLOB_NOT_FOUND', { detail: `Blob "${blobId}" not found` })
		const attachedTo = entry.attachedTo.filter(
			(a) => !(a.documentId === ref.documentId && a.recordRef === ref.recordRef),
		)
		this.updateBlobEntry({ ...entry, attachedTo })
	}

	async removeBlob(blobId: string): Promise<void> {
		this.database.exec({ sql: 'DELETE FROM _blobs WHERE id=?', bind: [blobId] })
	}

	// ── Internal helpers ─────────────────────────────────────────────────────

	private createSystemTables(): void {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS _documents (
				id TEXT PRIMARY KEY, name TEXT, extension TEXT, configKey TEXT,
				createdAt INTEGER, metadata TEXT
			);
			CREATE TABLE IF NOT EXISTS _changeLog (
				id INTEGER PRIMARY KEY AUTOINCREMENT, documentId TEXT, sequenceNumber INTEGER,
				timestamp INTEGER, operations TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_changelog_doc ON _changeLog(documentId);
			CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value INTEGER);
			CREATE TABLE IF NOT EXISTS _blobs (id TEXT PRIMARY KEY, documentId TEXT, entry TEXT, mime TEXT, data BLOB);
			CREATE INDEX IF NOT EXISTS idx_blobs_doc ON _blobs(documentId);
		`)
	}

	private query<GenericRow extends Record<string, SqlValue> = Record<string, SqlValue>>(
		sql: string,
		bind?: SqlBindable[],
	): GenericRow[] {
		const resultRows: Record<string, SqlValue>[] = []
		this.database.exec({ sql, bind, rowMode: 'object', resultRows })
		return resultRows as GenericRow[]
	}

	private hasTable(name: string): boolean {
		return (
			this.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]).length > 0
		)
	}

	private insertRecords(table: string, records: AnyRawRecord[]): void {
		if (!records.length) return
		const stmt = this.database.prepare(
			`INSERT OR REPLACE INTO "${table}" (${RECORD_INSERT_COLUMNS}) VALUES (${RECORD_PLACEHOLDERS})`,
		)
		try {
			for (const record of records) {
				stmt.bind(recordBindings(record))
				stmt.step()
				stmt.reset(true)
			}
		} finally {
			stmt.finalize()
		}
	}

	private deleteRecords(table: string, ids: string[]): void {
		if (!ids.length) return
		const stmt = this.database.prepare(`DELETE FROM "${table}" WHERE id=?`)
		try {
			for (const id of ids) {
				stmt.bind([id])
				stmt.step()
				stmt.reset(true)
			}
		} finally {
			stmt.finalize()
		}
	}

	private getRecordRow(table: string, id: string): AnyRawRecord | undefined {
		const rows = this.query(`SELECT * FROM "${table}" WHERE id=?`, [id])
		return rows[0] ? rowToRecord(rows[0]) : undefined
	}

	private getHead(documentId: string): number {
		const rows = this.query('SELECT value FROM _meta WHERE key=?', [`head:${documentId}`])
		return rows[0] ? (rows[0].value as number) : 0
	}

	private setHead(documentId: string, value: number): void {
		this.database.exec({
			sql: 'INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)',
			bind: [`head:${documentId}`, value],
		})
	}

	private getChangeLogOperations(
		documentId: string,
		sequenceNumber: number,
	): ChangeLogOperations | undefined {
		const rows = this.query(
			'SELECT operations FROM _changeLog WHERE documentId=? AND sequenceNumber=?',
			[documentId, sequenceNumber],
		)
		return rows[0] ? (JSON.parse(rows[0].operations as string) as ChangeLogOperations) : undefined
	}

	private allBlobEntries(): BlobRecord[] {
		return this.query('SELECT entry FROM _blobs').map((r) => JSON.parse(r.entry as string))
	}

	private getBlobEntry(blobId: string): BlobRecord | undefined {
		const rows = this.query('SELECT entry FROM _blobs WHERE id=?', [blobId])
		return rows[0] ? JSON.parse(rows[0].entry as string) : undefined
	}

	private updateBlobEntry(entry: BlobRecord): void {
		this.database.exec({
			sql: 'UPDATE _blobs SET entry=? WHERE id=?',
			bind: [JSON.stringify(entry), entry.id],
		})
	}
}

// ── Row <-> record mapping ─────────────────────────────────────────────────────

/** Approximate device RAM in GiB from the (Worker)Navigator, when exposed. */
function deviceMemoryGiB(): number | undefined {
	if (typeof navigator === 'undefined') return undefined
	return (navigator as { deviceMemory?: number }).deviceMemory
}

/** Rebuild every record's `children` from the `parentId` edges in one O(n) pass. */
function withDerivedChildren(records: AnyRawRecord[]): AnyRawRecord[] {
	const byParent = new Map<string, AnyRawRecord['children']>()
	for (const record of records) {
		if (!record.parent) continue
		const siblings = byParent.get(record.parent.id) ?? []
		siblings.push({ id: record.id, tagName: record.tagName })
		byParent.set(record.parent.id, siblings)
	}
	for (const record of records) record.children = byParent.get(record.id) ?? []
	return records
}

function recordBindings(record: AnyRawRecord): SqlBindable[] {
	return [
		record.id,
		record.tagName,
		record.namespace?.prefix ?? '',
		record.namespace?.uri ?? '',
		record.value ?? '',
		record.parent?.id ?? null,
		record.parent?.tagName ?? null,
		JSON.stringify(record.attributes),
	]
}

// `children` is derived from `parentId` on read, so rows carry an empty array here;
// callers that need the edge populate it via the engine's children reconstruction.
function rowToRecord(row: Record<string, SqlValue>): AnyRawRecord {
	return {
		id: row.id as string,
		tagName: row.tagName as string,
		namespace: { prefix: (row.nsPrefix as string) ?? '', uri: (row.nsUri as string) ?? '' },
		value: (row.value as string) ?? '',
		parent: row.parentId
			? { id: row.parentId as string, tagName: row.parentTagName as string }
			: null,
		attributes: JSON.parse((row.attributes as string) ?? '[]'),
		children: [],
	} as AnyRawRecord
}

function rowToDocument(row: Record<string, SqlValue>): DocumentRecord {
	return {
		id: row.id as string,
		name: row.name as string,
		extension: row.extension as string,
		configKey: row.configKey as string,
		createdAt: row.createdAt as number,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
	}
}

function mergePatch(existing: AnyRawRecord, patch: Omit<RecordPatch, 'recordId'>): AnyRawRecord {
	const merged: AnyRawRecord = { ...existing }
	if (patch.attributes) {
		const attributes = [...existing.attributes]
		for (const attr of patch.attributes) {
			const idx = attributes.findIndex((a) => a.name === attr.name)
			if (idx >= 0) attributes[idx] = attr
			else attributes.push(attr)
		}
		merged.attributes = attributes
	}
	if (patch.children) {
		const children = [...existing.children]
		for (const child of patch.children) {
			const idx = children.findIndex((c) => c.id === child.id)
			if (idx >= 0) children[idx] = child
			else children.push(child)
		}
		merged.children = children
	}
	return merged
}
