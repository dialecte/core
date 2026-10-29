import { ROW_SELECT_EXPRESSIONS, ROWS_PER_BIND } from '../engine/engine.constants'
import { columnDefinitions } from '../engine/schema'
import {
	AFTER_IMPORT_ATTRIBUTE,
	COMMIT_GROUP_ITEMS,
	RECORD_LAYOUT_COLUMNS,
	RECORD_ORDER_COLUMN,
	RECORD_SHARED_COLUMNS,
	SQLITE_DEFAULT_CACHE_PRAGMA,
	SQL_IDENTIFIER,
} from './bench.constants'

import { applyRecordPatch } from '@/store/apply-record-patch'

import type {
	BenchCache,
	BenchChangeEntry,
	BenchLayout,
	BenchParentChange,
	BenchPhase,
	BenchSteadyCache,
	BenchVariant,
	BenchWindowState,
	CommitCreatesParams,
	EditSteps,
	SinkTimings,
	VariantSink,
} from './bench.types'
import type { AnyRawRecord, AnyRelationship, RecordPatch } from '@/types'
import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm'

//====== LAYOUTS ======//

/**
 * A table or index name as a quoted SQL identifier. Names are built by the engine (records_<id>),
 * never taken from a file; anything else is refused rather than escaped.
 */
export function quoteIdentifier(params: { name: string }): string {
	if (!SQL_IDENTIFIER.test(params.name))
		throw new Error(`not a table name the engine builds: ${params.name}`)
	return `"${params.name}"`
}

function layoutColumns(params: { layout: BenchLayout }): string[] {
	return [...RECORD_SHARED_COLUMNS, RECORD_ORDER_COLUMN[params.layout]]
}

function tableDDL(params: { table: string; layout: BenchLayout; extraColumns?: string }): string {
	const { table, layout, extraColumns = '' } = params
	return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier({ name: table })} (${extraColumns}${columnDefinitions({ columns: RECORD_LAYOUT_COLUMNS[layout] })})`
}

/** The id index, and the read paths of the layout: tag name, plus the ordered parent edge for L2. */
function indexDDL(params: { table: string; layout: BenchLayout }): {
	id: string
	others: string[]
} {
	const { table, layout } = params
	const others = [
		`CREATE INDEX IF NOT EXISTS ${quoteIdentifier({ name: `${table}_tag` })} ON ${quoteIdentifier({ name: table })}(tagName)`,
	]
	if (layout === 'derived-position')
		others.push(
			`CREATE INDEX IF NOT EXISTS ${quoteIdentifier({ name: `${table}_parent` })} ON ${quoteIdentifier({ name: table })}(parentId, position)`,
		)
	return {
		id: `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier({ name: `${table}_id` })} ON ${quoteIdentifier({ name: table })}(id)`,
		others,
	}
}

/**
 * JSON1 select list: the engine's for L1 (text columns as SQL values, the JSON columns kept as JSON
 * text); L2's position, its last column, as a value.
 */
function json1SelectList(params: { layout: BenchLayout }): string {
	if (params.layout === 'children-column') return ROW_SELECT_EXPRESSIONS.join(', ')
	const shared = ROW_SELECT_EXPRESSIONS.slice(0, -1)
	return [...shared, `e.value->>${shared.length}`].join(', ')
}

//====== CACHE ======//

/**
 * A variant's two caches as SQLite `cache_size` values (negative = KiB): the import cache and the steady
 * cache. An import without a raise runs on the steady cache. `deviceCacheKiB` is the engine's rule for
 * the device (`deviceCacheMiB`), which both of the engine's caches follow; a caller that passes its own
 * size simulates another device, for both.
 */
export function cachePragmas(params: {
	cache: BenchCache
	steadyCache: BenchSteadyCache
	deviceCacheKiB: number
}): { importPragma: number; steadyPragma: number } {
	const { cache, steadyCache, deviceCacheKiB } = params
	const steadyPragma =
		typeof steadyCache === 'object'
			? -steadyCache.mib * 1024
			: {
					engine: -deviceCacheKiB,
					default: SQLITE_DEFAULT_CACHE_PRAGMA,
				}[steadyCache]
	if (typeof cache === 'object') return { importPragma: -cache.mib * 1024, steadyPragma }
	return { importPragma: cache === 'device' ? -deviceCacheKiB : steadyPragma, steadyPragma }
}

//====== ORDER SIGNATURES ======//

/** FNV-1a over a record's place and content: depth, tag, attribute values, text. */
export function recordSignature(params: {
	depth: number
	tagName: string
	attributeValues: readonly string[]
	value: string
}): number {
	const { depth, tagName, attributeValues, value } = params
	let hash = 0x811c9dc5
	const text = `${depth}|${tagName}|${attributeValues.join('\u0001')}|${value}`
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

//====== SINK ======//

export function emptySinkTimings(): SinkTimings {
	return {
		encodeMs: 0,
		insertMs: 0,
		updateReadMs: 0,
		updateWriteMs: 0,
		windowCommitMs: 0,
		idIndexMs: 0,
		finalizeIndexMs: 0,
		yieldMs: 0,
		windows: 0,
		longestWindowMs: 0,
		rowsWritten: 0,
		rowsPatched: 0,
	}
}

/**
 * The SQL a variant needs to import, edit and read one document table: no registry, no engine.
 * Import writes go through time- or size-capped window transactions with relaxed durability; every
 * other write runs between windows with the journal and `synchronous=FULL`.
 */
export function createVariantSink(params: {
	db: Database
	sqlite3Capi: Pick<Sqlite3Static['capi'], 'sqlite3_get_autocommit'>
	variant: BenchVariant
	cacheKiB: number
	/** told when a window opens or commits and when a failed import drops its table */
	onPhase?: (phase: BenchPhase) => void | Promise<void>
}): VariantSink {
	const { db, sqlite3Capi, variant, cacheKiB, onPhase = () => undefined } = params
	const { layout } = variant
	const columns = layoutColumns({ layout })
	const columnList = columns.join(',')
	const timings = emptySinkTimings()
	const window: BenchWindowState = { open: false, startedAt: 0, bytes: 0, waiters: [] }
	/** L2 import: the next position under each still-open parent (records arrive in post-order). */
	const importPositions = new Map<string, number>()
	const indexedTables = new Set<string>()
	const history: BenchChangeEntry[] = []
	let head = 0
	let scratchTables = 0
	let mode: 'window' | 'durable' = 'durable'
	const { importPragma: importCachePragma, steadyPragma: steadyCachePragma } = cachePragmas({
		cache: variant.cache,
		steadyCache: variant.steadyCache,
		deviceCacheKiB: cacheKiB,
	})
	let importCacheRaised = false
	db.exec(`PRAGMA cache_size=${steadyCachePragma}`)

	db.exec(
		`CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY, tableName TEXT, kind TEXT, payload TEXT);` +
			`${tableDDL({ table: 'change_rows', layout, extraColumns: 'seq INTEGER NOT NULL, ' })};` +
			'CREATE INDEX IF NOT EXISTS change_rows_seq ON change_rows(seq);',
	)

	/**
	 * The import cache is raised at the first window and kept until the import ends: lowering it for
	 * a commit between two windows would evict the import's pages (measured: they are read again).
	 */
	function raiseImportCache(): void {
		if (importCacheRaised) return
		db.exec(`PRAGMA cache_size=${importCachePragma}`)
		importCacheRaised = true
	}

	function restoreSteadyCache(): void {
		if (!importCacheRaised) return
		db.exec(`PRAGMA cache_size=${steadyCachePragma}`)
		importCacheRaised = false
	}

	function enterWindowMode(): void {
		raiseImportCache()
		if (mode === 'window') return
		const journal = variant.journal === 'off' ? 'OFF' : 'TRUNCATE'
		db.exec(`PRAGMA synchronous=OFF; PRAGMA journal_mode=${journal};`)
		mode = 'window'
	}

	function enterDurableMode(): void {
		if (mode === 'durable') return
		db.exec('PRAGMA synchronous=FULL; PRAGMA journal_mode=TRUNCATE;')
		mode = 'durable'
	}

	function openWindow(): void {
		if (window.open) return
		enterWindowMode()
		db.exec('BEGIN')
		onPhase('window-open')
		window.open = true
		window.startedAt = performance.now()
		window.bytes = 0
	}

	function closeWindow(): void {
		if (!window.open) return
		const startedAt = performance.now()
		db.exec('COMMIT')
		onPhase('window-committed')
		const endedAt = performance.now()
		timings.windowCommitMs += endedAt - startedAt
		timings.windows += 1
		timings.longestWindowMs = Math.max(timings.longestWindowMs, endedAt - window.startedAt)
		window.open = false
		window.waiters.splice(0).forEach(function release(resolve) {
			resolve()
		})
	}

	function capReached(): boolean {
		if (variant.window.kind === 'time')
			return performance.now() - window.startedAt >= variant.window.ms
		return window.bytes >= variant.window.bytes
	}

	/** Close the window at its cap and give the message queue a turn: reads and commits run there. */
	async function closeWindowAtCap(): Promise<void> {
		if (!window.open || !capReached()) return
		closeWindow()
		const startedAt = performance.now()
		await yieldToQueue()
		timings.yieldMs += performance.now() - startedAt
	}

	/** One index per window transaction, the queue served after each: an index build is one long statement. */
	async function buildIndexAlone(params: { ddl: string }): Promise<void> {
		openWindow()
		db.exec(params.ddl)
		closeWindow()
		const startedAt = performance.now()
		await yieldToQueue()
		timings.yieldMs += performance.now() - startedAt
	}

	function ensureIdIndex(params: { table: string }): void {
		if (indexedTables.has(params.table)) return
		const startedAt = performance.now()
		db.exec(indexDDL({ table: params.table, layout }).id)
		timings.idIndexMs += performance.now() - startedAt
		indexedTables.add(params.table)
	}

	function nextPosition(params: { counters: Map<string, number>; parentId: string }): number {
		const { counters, parentId } = params
		const position = (counters.get(parentId) ?? 0) + 1
		counters.set(parentId, position)
		return position
	}

	/**
	 * The record as a row of the layout, JSON columns as values (JSON1) or as text (per row). L2
	 * numbers siblings in arrival order with `counters` (document order for pre- and post-order).
	 */
	function encodeRow(params: {
		record: AnyRawRecord
		asText: boolean
		counters?: Map<string, number>
	}): unknown[] {
		const { record, asText, counters = importPositions } = params
		const attributes = asText ? JSON.stringify(record.attributes) : record.attributes
		let order: unknown
		if (layout === 'children-column') {
			order = asText ? JSON.stringify(record.children) : record.children
		} else {
			// post-order: siblings close in document order, so a counter per parent numbers them
			order = nextPosition({ counters, parentId: record.parent?.id ?? '' })
			counters.delete(record.id)
		}
		return [
			record.id,
			record.tagName,
			record.namespace.prefix,
			record.namespace.uri,
			record.value,
			record.parent?.id ?? null,
			record.parent?.tagName ?? null,
			attributes,
			order,
		]
	}

	function insertJson1(params: { target: string; rows: unknown[][]; seq?: number }): void {
		const { target, rows, seq } = params
		const seqColumn = seq === undefined ? '' : 'seq,'
		const seqValue = seq === undefined ? '' : `${seq},`
		const statement = db.prepare(
			`INSERT INTO ${quoteIdentifier({ name: target })} (${seqColumn}${columnList}) SELECT ${seqValue}${json1SelectList({ layout })} FROM json_each(?) e`,
		)
		try {
			for (let start = 0; start < rows.length; start += ROWS_PER_BIND) {
				const encodeStartedAt = performance.now()
				const payload = JSON.stringify(rows.slice(start, start + ROWS_PER_BIND))
				const insertStartedAt = performance.now()
				timings.encodeMs += insertStartedAt - encodeStartedAt
				statement.bind([payload]).stepReset()
				timings.insertMs += performance.now() - insertStartedAt
				window.bytes += payload.length
			}
		} finally {
			statement.finalize()
		}
	}

	function insertPerRow(params: { table: string; records: AnyRawRecord[] }): void {
		const placeholders = columns.map(() => '?').join(',')
		const statement = db.prepare(
			`INSERT INTO ${quoteIdentifier({ name: params.table })} (${columnList}) VALUES (${placeholders})`,
		)
		try {
			for (const record of params.records) {
				const encodeStartedAt = performance.now()
				const row = encodeRow({ record, asText: true }) as SqlValue[]
				const insertStartedAt = performance.now()
				timings.encodeMs += insertStartedAt - encodeStartedAt
				statement.bind(row).stepReset()
				timings.insertMs += performance.now() - insertStartedAt
				window.bytes += row.reduce<number>((sum, value) => sum + String(value ?? '').length, 0)
			}
		} finally {
			statement.finalize()
		}
	}

	async function writeCreates(params: { table: string; records: AnyRawRecord[] }): Promise<void> {
		const { table, records } = params
		openWindow()
		if (variant.insert === 'per-row') {
			insertPerRow({ table, records })
		} else {
			const encodeStartedAt = performance.now()
			const rows = records.map((record) => encodeRow({ record, asText: false }))
			timings.encodeMs += performance.now() - encodeStartedAt
			insertJson1({ target: table, rows })
		}
		timings.rowsWritten += records.length
		await closeWindowAtCap()
	}

	/**
	 * Patches in chunks: one JSON1 read of the chunk's rows, the merge in JS (the port's patch
	 * semantics), one JSON1 `UPDATE ... FROM` write.
	 */
	async function writeUpdates(params: { table: string; patches: RecordPatch[] }): Promise<void> {
		const { table, patches } = params
		openWindow()
		ensureIdIndex({ table })
		const select = db.prepare(
			`SELECT ${columnList} FROM ${quoteIdentifier({ name: table })} WHERE id IN (SELECT value FROM json_each(?))`,
		)
		const assignments = columns
			.slice(1)
			.map((column, index) => `${column} = u.c${index + 1}`)
			.join(', ')
		const aliases = json1SelectList({ layout })
			.split(', ')
			.map((expression, index) => `${expression} AS c${index}`)
			.join(', ')
		const update = db.prepare(
			`UPDATE ${quoteIdentifier({ name: table })} SET ${assignments} FROM (SELECT ${aliases} FROM json_each(?) e) AS u WHERE ${quoteIdentifier({ name: table })}.id = u.c0`,
		)
		try {
			for (let start = 0; start < patches.length; start += ROWS_PER_BIND) {
				openWindow()
				const chunk = patches.slice(start, start + ROWS_PER_BIND)
				const readStartedAt = performance.now()
				select.bind([JSON.stringify(chunk.map((patch) => patch.recordId))])
				const stored = new Map<string, { record: AnyRawRecord; row: SqlValue[] }>()
				while (select.step()) {
					const row = select.get([]) as SqlValue[]
					stored.set(String(row[0]), { record: rowToRecord({ row, layout }), row })
				}
				select.reset(true)
				const writeStartedAt = performance.now()
				timings.updateReadMs += writeStartedAt - readStartedAt
				for (const patch of chunk) {
					const held = stored.get(patch.recordId)
					if (!held)
						throw new Error(`write-back of a record the table does not hold: ${patch.recordId}`)
					held.record = applyRecordPatch({ record: held.record, patch })
				}
				const payload = JSON.stringify(
					[...stored.values()].map(({ record, row }) => encodeUpdateRow({ record, row })),
				)
				update.bind([payload]).stepReset()
				const changed = db.changes()
				if (changed !== stored.size)
					throw new Error(`write-back changed ${changed} rows of the ${stored.size} patched`)
				timings.updateWriteMs += performance.now() - writeStartedAt
				window.bytes += payload.length
				timings.rowsWritten += stored.size
				timings.rowsPatched += stored.size
				await closeWindowAtCap()
			}
		} finally {
			select.finalize()
			update.finalize()
		}
	}

	/** The patched record as a JSON1 update row: its position (L2) is kept from the stored row. */
	function encodeUpdateRow(params: { record: AnyRawRecord; row: SqlValue[] }): unknown[] {
		const { record, row } = params
		const order = layout === 'children-column' ? record.children : row[8]
		return [
			record.id,
			record.tagName,
			record.namespace.prefix,
			record.namespace.uri,
			record.value,
			record.parent?.id ?? null,
			record.parent?.tagName ?? null,
			record.attributes,
			order,
		]
	}

	function createDocumentTable(params: { table: string }): void {
		const { table } = params
		importPositions.clear()
		db.exec(tableDDL({ table, layout }))
		const { id, others } = indexDDL({ table, layout })
		if (variant.index === 'lazy-id') return
		db.exec(variant.index === 'index-first' ? [id, ...others].join(';') : id)
		indexedTables.add(table)
	}

	async function finalizeImport(params: { table: string }): Promise<void> {
		const { table } = params
		closeWindow()
		const startedAt = performance.now()
		if (variant.index !== 'index-first') {
			const { id, others } = indexDDL({ table, layout })
			if (!indexedTables.has(table)) {
				const idStartedAt = performance.now()
				await buildIndexAlone({ ddl: id })
				timings.idIndexMs += performance.now() - idStartedAt
				indexedTables.add(table)
			}
			for (const ddl of others) await buildIndexAlone({ ddl })
		}
		timings.finalizeIndexMs += performance.now() - startedAt
		enterDurableMode()
		restoreSteadyCache()
		importPositions.clear()
	}

	/** J1 rolls the open window back; J2 cannot (no journal): it commits, and the table is dropped. */
	async function failImport(params: { table: string }): Promise<void> {
		onPhase('failing')
		if (window.open) {
			// an I/O, full or out-of-memory error has already rolled the transaction back
			if (isTransactionActive()) db.exec(variant.journal === 'off' ? 'COMMIT' : 'ROLLBACK')
			window.open = false
			window.waiters.splice(0).forEach(function release(resolve) {
				resolve()
			})
		}
		enterDurableMode()
		restoreSteadyCache()
		// awaited: a kill test holds here, between the commit of a failed window and its drop
		await onPhase('dropping')
		dropTable({ table: params.table })
		onPhase('dropped')
		importPositions.clear()
	}

	function dropTable(params: { table: string }): void {
		const { table } = params
		db.exec('BEGIN IMMEDIATE')
		try {
			db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier({ name: table })}`)
			db.exec({
				sql: 'DELETE FROM change_rows WHERE seq IN (SELECT seq FROM changes WHERE tableName = ?)',
				bind: [table],
			})
			db.exec({ sql: 'DELETE FROM changes WHERE tableName = ?', bind: [table] })
			db.exec('COMMIT')
		} catch (thrown) {
			db.exec('ROLLBACK')
			throw thrown
		}
		indexedTables.delete(table)
		if (variant.vacuum === 'incremental') reclaimFreePages({ db })
	}

	function isTransactionActive(): boolean {
		return sqlite3Capi.sqlite3_get_autocommit(db) === 0
	}

	async function runOutsideWindow<GenericResult>(
		work: () => GenericResult,
	): Promise<GenericResult> {
		while (window.open) await new Promise<void>((resolve) => window.waiters.push(resolve))
		enterDurableMode()
		return work()
	}

	/** One edit as a timed transaction: `work` marks its sub-steps with `lap`, the commit is timed last. */
	function timedEdit(work: (lap: (step: keyof EditSteps) => void) => number): EditSteps {
		const steps: EditSteps = {
			records: 0,
			collectMs: 0,
			historyMs: 0,
			rowsMs: 0,
			parentMs: 0,
			commitMs: 0,
			totalMs: 0,
		}
		const startedAt = performance.now()
		let lastAt = startedAt
		const lap = (step: keyof EditSteps): void => {
			const now = performance.now()
			steps[step] += now - lastAt
			lastAt = now
		}
		enterDurableMode()
		db.exec('BEGIN IMMEDIATE')
		try {
			steps.records = work(lap)
			lastAt = performance.now()
			db.exec('COMMIT')
			lap('commitMs')
		} catch (thrown) {
			db.exec('ROLLBACK')
			throw thrown
		}
		steps.totalMs = performance.now() - startedAt
		return steps
	}

	function readChildren(params: { table: string; parentId: string }): AnyRelationship[] {
		const { table, parentId } = params
		if (layout === 'children-column') {
			const text = db.selectValue(
				`SELECT children FROM ${quoteIdentifier({ name: table })} WHERE id = ?`,
				[parentId],
			)
			return text ? (JSON.parse(String(text)) as AnyRelationship[]) : []
		}
		return db
			.selectArrays(
				`SELECT id, tagName FROM ${quoteIdentifier({ name: table })} WHERE parentId = ? ORDER BY position`,
				[parentId],
			)
			.map(([id, tagName]) => ({ id: String(id), tagName: String(tagName) }))
	}

	function writeChildren(params: {
		table: string
		parentId: string
		children: AnyRelationship[]
	}): void {
		db.exec({
			sql: `UPDATE ${quoteIdentifier({ name: params.table })} SET children = json(?) WHERE id = ?`,
			bind: [JSON.stringify(params.children), params.parentId],
		})
	}

	function recordChange(params: Omit<BenchChangeEntry, 'seq'>): BenchChangeEntry {
		const { table, kind, ...payload } = params
		db.exec({
			sql: 'INSERT INTO changes (tableName, kind, payload) VALUES (?, ?, ?)',
			bind: [table, kind, JSON.stringify(payload)],
		})
		const seq = Number(db.selectValue('SELECT last_insert_rowid()'))
		const entry = { ...params, seq }
		history.splice(head)
		history.push(entry)
		head = history.length
		return entry
	}

	function commitCreates(params: CommitCreatesParams): EditSteps {
		const { table, parentId, afterSiblingId, records } = params
		return timedEdit(function commitCreatesTransaction(lap) {
			const siblings = readChildren({ table, parentId })
			const at = siblings.findIndex((sibling) => sibling.id === afterSiblingId) + 1
			const root = records.find((record) => record.parent?.id === parentId)
			if (!root) throw new Error('the created records hold no child of the parent')
			const rows = encodeCreatedRows({ table, parentId, records, root, siblings, at })
			const after = [...siblings]
			after.splice(at, 0, { id: root.id, tagName: root.tagName })
			const entry = recordChange({
				table,
				kind: 'create',
				parents:
					layout === 'children-column'
						? [{ parentId, childrenBefore: siblings, childrenAfter: after }]
						: [],
			})
			lap('collectMs')
			insertJson1({ target: table, rows })
			lap('rowsMs')
			insertJson1({ target: 'change_rows', rows, seq: entry.seq })
			lap('historyMs')
			if (layout === 'children-column') writeChildren({ table, parentId, children: after })
			lap('parentMs')
			return records.length
		})
	}

	/** Rows of a created subtree; under L2 its root takes a position between its two new siblings. */
	function encodeCreatedRows(params: {
		table: string
		parentId: string
		records: AnyRawRecord[]
		root: AnyRawRecord
		siblings: AnyRelationship[]
		at: number
	}): unknown[][] {
		const { table, parentId, records, root, siblings, at } = params
		const counters = new Map<string, number>()
		const rows = records.map((record) => encodeRow({ record, asText: false, counters }))
		if (layout === 'derived-position')
			rows[records.indexOf(root)]![8] = positionBetween({ table, parentId, siblings, at })
		return rows
	}

	/**
	 * The midpoint of the two neighbours' positions (REAL, numbered with gaps); when the gap is
	 * exhausted the parent's children are renumbered 1..n first.
	 */
	function positionBetween(params: {
		table: string
		parentId: string
		siblings: AnyRelationship[]
		at: number
	}): number {
		const { table, parentId, siblings, at } = params
		const positionOf = (index: number): number | undefined => {
			const sibling = siblings[index]
			return sibling
				? Number(
						db.selectValue(
							`SELECT position FROM ${quoteIdentifier({ name: table })} WHERE id = ?`,
							[sibling.id],
						),
					)
				: undefined
		}
		const before = positionOf(at - 1) ?? 0
		const after = positionOf(at) ?? before + 2
		const middle = (before + after) / 2
		if (middle > before && middle < after) return middle
		db.exec({
			sql:
				`WITH ranked AS (SELECT id, row_number() OVER (ORDER BY position) AS rank FROM ${quoteIdentifier({ name: table })} WHERE parentId = ?) ` +
				`UPDATE ${quoteIdentifier({ name: table })} SET position = (SELECT rank FROM ranked WHERE ranked.id = ${quoteIdentifier({ name: table })}.id) WHERE parentId = ?`,
			bind: [parentId, parentId],
		})
		return at + 0.5
	}

	/**
	 * Run `work` with the subtree ids of `rootIds` in a temp table of its own (dropped after), so two
	 * walks never share one scratch table.
	 */
	function withSubtreeIds<GenericResult>(
		params: { table: string; rootIds: string[] },
		work: (scratch: { name: string; count: number }) => GenericResult,
	): GenericResult {
		const { table, rootIds } = params
		scratchTables += 1
		const name = `subtree_${scratchTables}`
		const step =
			layout === 'children-column'
				? `SELECT j.value->>'id' FROM s JOIN ${quoteIdentifier({ name: table })} t ON t.id = s.id, json_each(t.children) j`
				: `SELECT t.id FROM s JOIN ${quoteIdentifier({ name: table })} t ON t.parentId = s.id`
		db.exec(`CREATE TEMP TABLE ${name} (id TEXT PRIMARY KEY)`)
		try {
			db.exec({
				sql: `WITH RECURSIVE s(id) AS (SELECT value FROM json_each(?) UNION ALL ${step}) INSERT INTO temp.${name} SELECT id FROM s`,
				bind: [JSON.stringify(rootIds)],
			})
			return work({
				name: `temp.${name}`,
				count: Number(db.selectValue(`SELECT count(*) FROM temp.${name}`)),
			})
		} finally {
			db.exec(`DROP TABLE temp.${name}`)
		}
	}

	/** Each root's parent, its children list before the delete and after it (L1 keeps the lists; L2 has none). */
	function parentChangesForDelete(params: {
		table: string
		rootIds: string[]
	}): BenchParentChange[] {
		const { table, rootIds } = params
		const removed = new Set(rootIds)
		const parentIds = new Set(
			db
				.selectArrays(
					`SELECT parentId FROM ${quoteIdentifier({ name: table })} WHERE id IN (SELECT value FROM json_each(?))`,
					[JSON.stringify(rootIds)],
				)
				.map(([parentId]) => {
					if (parentId === null) throw new Error('the document root cannot be deleted')
					return String(parentId)
				}),
		)
		if (layout !== 'children-column') return []
		return [...parentIds].map((parentId) => {
			const childrenBefore = readChildren({ table, parentId })
			return {
				parentId,
				childrenBefore,
				childrenAfter: childrenBefore.filter((child) => !removed.has(child.id)),
			}
		})
	}

	function deleteSubtrees(params: { table: string; rootIds: string[] }): EditSteps {
		const { table, rootIds } = params
		return timedEdit(function deleteSubtreesTransaction(lap) {
			return withSubtreeIds({ table, rootIds }, function deleteCollected(scratch) {
				const parents = parentChangesForDelete({ table, rootIds })
				const entry = recordChange({ table, kind: 'delete', parents })
				lap('collectMs')
				db.exec({
					sql: `INSERT INTO change_rows (seq,${columnList}) SELECT ?,${columnList} FROM ${quoteIdentifier({ name: table })} WHERE id IN (SELECT id FROM ${scratch.name})`,
					bind: [entry.seq],
				})
				lap('historyMs')
				db.exec(
					`DELETE FROM ${quoteIdentifier({ name: table })} WHERE id IN (SELECT id FROM ${scratch.name})`,
				)
				lap('rowsMs')
				for (const { parentId, childrenAfter } of parents)
					writeChildren({ table, parentId, children: childrenAfter })
				lap('parentMs')
				return scratch.count
			})
		})
	}

	function restoreRows(params: { entry: BenchChangeEntry }): number {
		const { entry } = params
		db.exec({
			sql: `INSERT INTO ${quoteIdentifier({ name: entry.table })} (${columnList}) SELECT ${columnList} FROM change_rows WHERE seq = ?`,
			bind: [entry.seq],
		})
		return db.changes()
	}

	function removeRows(params: { entry: BenchChangeEntry }): number {
		const { entry } = params
		db.exec({
			sql: `DELETE FROM ${quoteIdentifier({ name: entry.table })} WHERE id IN (SELECT id FROM change_rows WHERE seq = ?)`,
			bind: [entry.seq],
		})
		return db.changes()
	}

	function undo(params: { table: string }): EditSteps {
		const entry = history[head - 1]
		if (!entry || entry.table !== params.table) throw new Error('nothing to undo')
		const steps = timedEdit(function undoTransaction(lap) {
			const records = entry.kind === 'delete' ? restoreRows({ entry }) : removeRows({ entry })
			lap('rowsMs')
			// L1: each parent's children as they were before the change; L2 rows carry their position back
			for (const { parentId, childrenBefore } of entry.parents)
				writeChildren({ table: entry.table, parentId, children: childrenBefore })
			lap('parentMs')
			return records
		})
		head -= 1
		return steps
	}

	function redo(params: { table: string }): EditSteps {
		const entry = history[head]
		if (!entry || entry.table !== params.table) throw new Error('nothing to redo')
		const steps = timedEdit(function redoTransaction(lap) {
			const records = entry.kind === 'delete' ? removeRows({ entry }) : restoreRows({ entry })
			lap('rowsMs')
			for (const { parentId, childrenAfter } of entry.parents)
				writeChildren({ table: entry.table, parentId, children: childrenAfter })
			lap('parentMs')
			return records
		})
		head += 1
		return steps
	}

	/** A subtree in document order, each record with its children in sibling order. */
	function readTree(params: { table: string; rootId: string }): AnyRawRecord[] {
		const { table, rootId } = params
		const rows = withSubtreeIds({ table, rootIds: [rootId] }, (scratch) =>
			db.selectArrays(
				`SELECT ${columnList} FROM ${quoteIdentifier({ name: table })} WHERE id IN (SELECT id FROM ${scratch.name})`,
			),
		)
		const records = rows.map((row) => rowToRecord({ row, layout }))
		if (layout === 'derived-position') attachDerivedChildren({ records, rows })
		return inDocumentOrder({ records, rootId }).map(({ record }) => record)
	}

	function readByTagName(params: { table: string; tagName: string }): AnyRawRecord[] {
		const { table, tagName } = params
		const rows = db.selectArrays(
			`SELECT ${columnList} FROM ${quoteIdentifier({ name: table })} WHERE tagName = ?`,
			[tagName],
		)
		const records = rows.map((row) => rowToRecord({ row, layout }))
		if (layout === 'children-column') return records
		const byId = new Map(records.map((record) => [record.id, record]))
		const children = db.selectArrays(
			`SELECT c.parentId, c.id, c.tagName FROM ${quoteIdentifier({ name: table })} p JOIN ${quoteIdentifier({ name: table })} c ON c.parentId = p.id ` +
				'WHERE p.tagName = ? ORDER BY c.parentId, c.position',
			[tagName],
		)
		for (const [parentId, id, childTag] of children)
			byId.get(String(parentId))?.children.push({ id: String(id), tagName: String(childTag) })
		return records
	}

	/** Every record of the table in document order, as order signatures. */
	function readOrderedSignatures(params: { table: string }): Uint32Array {
		const { table } = params
		const rows = db.selectArrays(`SELECT ${columnList} FROM ${quoteIdentifier({ name: table })}`)
		const records = rows.map((row) => rowToRecord({ row, layout }))
		if (layout === 'derived-position') attachDerivedChildren({ records, rows })
		const root = records.find((record) => record.parent === null)
		if (!root) return new Uint32Array(0)
		const ordered = inDocumentOrder({ records, rootId: root.id })
		// every stored record reachable from the root, once: a stray row or a lost link is a broken tree
		if (ordered.length !== records.length)
			throw new Error(
				`${records.length - ordered.length} stored records are not reachable from the root`,
			)
		return Uint32Array.from(ordered, ({ record, depth }) =>
			recordSignature({
				depth,
				tagName: record.tagName,
				// the write-back arm's own attribute is not part of the source
				attributeValues: record.attributes
					.filter((attribute) => attribute.name !== AFTER_IMPORT_ATTRIBUTE)
					.map((attribute) => attribute.value),
				value: record.value,
			}),
		)
	}

	/** L2: each record's children from the parent edge, in position order. */
	function attachDerivedChildren(params: { records: AnyRawRecord[]; rows: SqlValue[][] }): void {
		const { records, rows } = params
		const byId = new Map(records.map((record) => [record.id, record]))
		const ordered = records
			.map((record, index) => ({ record, position: Number(rows[index]![8]) }))
			.sort((left, right) => left.position - right.position)
		for (const { record } of ordered) {
			const parentId = record.parent?.id
			if (parentId) byId.get(parentId)?.children.push({ id: record.id, tagName: record.tagName })
		}
	}

	return {
		createDocumentTable,
		writeCreates,
		writeUpdates,
		finalizeImport,
		failImport,
		dropTable,
		runOutsideWindow,
		commitCreates,
		deleteSubtrees,
		undo,
		redo,
		readTree,
		readChildren,
		countSubtree: ({ table, rootId }) =>
			withSubtreeIds({ table, rootIds: [rootId] }, ({ count }) => count),
		readByTagName,
		readOrderedSignatures,
		timings,
	}
}

/** A stored row back as a record; L2 rows carry no children (the caller derives them). */
export function rowToRecord(params: { row: SqlValue[]; layout: BenchLayout }): AnyRawRecord {
	const { row, layout } = params
	const [id, tagName, nsPrefix, nsUri, value, parentId, parentTagName, attributes, order] = row
	return {
		id: String(id),
		tagName: String(tagName),
		namespace: { prefix: String(nsPrefix ?? ''), uri: String(nsUri ?? '') },
		value: String(value ?? ''),
		parent: parentId === null ? null : { id: String(parentId), tagName: String(parentTagName) },
		attributes: JSON.parse(String(attributes)) as AnyRawRecord['attributes'],
		children: layout === 'children-column' ? (JSON.parse(String(order)) as AnyRelationship[]) : [],
	}
}

/**
 * A created subtree in document order: one root under `parentId`, then groups of up to 999
 * items, `count` records in all (a deepClone-sized commit when large).
 */
export function buildCommitRecords(params: { parentId: string; count: number }): AnyRawRecord[] {
	const { parentId, count } = params
	const namespace = { prefix: '', uri: '' }
	const root = newRecord({
		tagName: 'BenchCommit',
		parent: { id: parentId, tagName: 'parent' },
		index: 0,
	})
	const records: AnyRawRecord[] = [root]
	let group: AnyRawRecord | undefined
	while (records.length < count) {
		if (!group || group.children.length >= COMMIT_GROUP_ITEMS) {
			group = newRecord({ tagName: 'BenchGroup', parent: root, index: records.length })
			root.children.push({ id: group.id, tagName: group.tagName })
			records.push(group)
			continue
		}
		const item = newRecord({ tagName: 'BenchItem', parent: group, index: records.length })
		group.children.push({ id: item.id, tagName: item.tagName })
		records.push(item)
	}
	return records

	function newRecord(params: {
		tagName: string
		parent: { id: string; tagName: string }
		index: number
	}): AnyRawRecord {
		return {
			id: crypto.randomUUID(),
			tagName: params.tagName,
			namespace,
			attributes: [{ name: 'name', value: `n${params.index}` }],
			value: '',
			parent: { id: params.parent.id, tagName: params.parent.tagName },
			children: [],
		}
	}
}

/** Depth-first from the root, children in their stored order: the document order the layout keeps. */
function inDocumentOrder(params: {
	records: AnyRawRecord[]
	rootId: string
}): Array<{ record: AnyRawRecord; depth: number }> {
	const { records, rootId } = params
	const byId = new Map(records.map((record) => [record.id, record]))
	const ordered: Array<{ record: AnyRawRecord; depth: number }> = []
	const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]
	for (let next = stack.pop(); next; next = stack.pop()) {
		const record = byId.get(next.id)
		if (!record)
			throw new Error(`a children list names a record the table does not hold: ${next.id}`)
		ordered.push({ record, depth: next.depth })
		for (let index = record.children.length - 1; index >= 0; index--)
			stack.push({ id: record.children[index]!.id, depth: next.depth + 1 })
	}
	return ordered
}

function yieldToQueue(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Give the free pages back to the file (incremental auto-vacuum): after a document's table is
 * dropped, the file shrinks by its pages. One step frees one page: stepped to the end.
 */
function reclaimFreePages(params: { db: Database }): void {
	const statement = params.db.prepare('PRAGMA incremental_vacuum')
	try {
		while (statement.step());
	} finally {
		statement.finalize()
	}
}
