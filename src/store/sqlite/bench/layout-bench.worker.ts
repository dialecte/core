import { deviceCacheMiB, reportedDeviceMemoryGiB } from '../engine/device-cache'
import { benchConfig, createWriteBackSession } from './bench-import-session'
import { realmMemory } from './bench-memory'
import { directoryBytes, findDirectory, installPool } from './bench-pool'
import { buildCommitRecords, createVariantSink, recordSignature } from './bench-variants'
import {
	BENCH_PHASE_MESSAGE,
	KILL_HOLD_MS,
	ORDER_COMMIT_RECORDS,
	POOL_DATABASE_PATH,
	READ_TARGET_CANDIDATES,
	READ_TARGET_RECORDS,
	SIDE_DOCUMENT_ID,
	SMALL_COMMIT_RECORDS,
	VFS_ERRORS_KEPT,
} from './bench.constants'

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as Comlink from 'comlink'
import * as sax from 'sax'

import { readXmlTextRun } from '@/utils/xml-whitespace'
import { parseXmlFile } from '@/xml'
import { SAX_PARSER_OPTIONS } from '@/xml/parse/parser.constants'

import type {
	BenchPhase,
	BenchVariant,
	BenchWorkerApi,
	OpenedBenchPool,
	DatabaseSizes,
	ImportFileParams,
	ImportFileResult,
	OrderComparison,
} from './bench.types'
import type { AnyRawRecord } from '@/types'
import type { ParseTarget } from '@/xml/parse/parse-xml-document.types'
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The DOM lib types `self` as a window; this worker only posts plain messages to its page. */
const workerScope = self as unknown as { postMessage: (message: unknown) => void }

/** The sahpool VFS reports the exception behind an SQLITE_IOERR on `console.error` only: keep the last ones. */
const vfsErrors: string[] = []
const consoleError = console.error.bind(console)
console.error = function keepVfsError(...args: unknown[]) {
	vfsErrors.push(
		args
			.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
			.join(' '),
	)
	vfsErrors.splice(0, vfsErrors.length - VFS_ERRORS_KEPT)
	consoleError(...args)
}

let sqlitePromise: Promise<Sqlite3Static> | undefined
let opened: OpenedBenchPool | undefined

function loadSqlite(): Promise<Sqlite3Static> {
	sqlitePromise ??= sqlite3InitModule()
	return sqlitePromise
}

function requireOpened(): OpenedBenchPool {
	if (!opened) throw new Error('bench pool not opened')
	return opened
}

function tableOf(params: { documentId: string }): string {
	return `records_${params.documentId.replaceAll(/[^A-Za-z0-9_]/g, '_')}`
}

function openDatabase(params: { pool: SAHPoolUtil; variant: BenchVariant }): Database {
	const db = new params.pool.OpfsSAHPoolDb(POOL_DATABASE_PATH)
	const vacuum = params.variant.vacuum === 'incremental' ? 'INCREMENTAL' : 'NONE'
	// auto_vacuum only takes on a file without tables
	db.exec(
		`PRAGMA auto_vacuum=${vacuum}; PRAGMA locking_mode=EXCLUSIVE; PRAGMA temp_store=MEMORY; ` +
			'PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=FULL;' +
			'CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, tableName TEXT, status TEXT);',
	)
	return db
}

async function importFile(params: ImportFileParams): Promise<ImportFileResult> {
	const { sink, db, roots } = requireOpened()
	const { file, documentId, afterImportRatio, failAfterRecords, root } = params
	const table = tableOf({ documentId })
	const startedAt = performance.now()
	db.exec({
		sql: 'INSERT INTO documents (id, tableName, status) VALUES (?, ?, ?)',
		bind: [documentId, table, 'importing'],
	})
	sink.createDocumentTable({ table })
	const sessionTimings = { afterImportBuildMs: 0 }
	const writes = { createsMs: 0, updatesMs: 0, updates: 0 }
	const store: ParseTarget = {
		bulkWrite: async function benchBulkWrite(_documentId, { creates, updates, deletes }) {
			// the write-back arm replays updates only; a delete here would be a write the sinks do not run
			if (deletes?.length) throw new Error('the bench sinks take creates and updates only')
			const writeStartedAt = performance.now()
			if (creates?.length) {
				await sink.writeCreates({ table, records: creates })
				writes.createsMs += performance.now() - writeStartedAt
			}
			if (updates?.length) {
				await sink.writeUpdates({ table, patches: updates })
				writes.updatesMs += performance.now() - writeStartedAt
				writes.updates += updates.length
			}
		},
		writeSession: async function benchSessionWrite(documentId, ops) {
			await store.bulkWrite(documentId, ops)
		},
	}
	const session = createWriteBackSession({
		ratio: afterImportRatio,
		failAfterRecords,
		onRoot: (id) => roots.set(documentId, id),
		timings: sessionTimings,
	})
	let records = 0
	let failed: string | undefined
	try {
		const result = await parseXmlFile({
			file,
			documentId,
			configKey: 'default',
			store,
			config: benchConfig(root),
			hooks: { createImportSession: () => session },
		})
		records = result.recordCount
	} catch (thrown) {
		failed = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
		if (vfsErrors.length) failed += ` [vfs: ${vfsErrors.join(' | ')}]`
		const { usage, quota } = await navigator.storage.estimate()
		failed += ` [storage: usage ${usage} of quota ${quota}]`
		try {
			await sink.failImport({ table })
			db.exec({ sql: 'DELETE FROM documents WHERE id = ?', bind: [documentId] })
		} catch (cleanup) {
			failed += ` (then the drop failed: ${String(cleanup)})`
		}
	}
	const parsedAt = performance.now()
	if (!failed) {
		await sink.finalizeImport({ table })
		db.exec({ sql: "UPDATE documents SET status = 'ready' WHERE id = ?", bind: [documentId] })
	}
	const endedAt = performance.now()
	const loopMs = parsedAt - startedAt
	return {
		records,
		updates: writes.updates,
		failed,
		stages: {
			parseMs: loopMs - writes.createsMs - writes.updatesMs - sessionTimings.afterImportBuildMs,
			hooksArmMs: sessionTimings.afterImportBuildMs,
			afterWritesMs: writes.updatesMs,
			finalizeMs: endedAt - parsedAt,
			totalWorkerMs: endedAt - startedAt,
		},
		sink: { ...sink.timings },
	}
}

/**
 * Post the phase to the page; at `holdAt`, wait on the event loop so the page's kill lands there (a
 * terminated worker stops at its next task boundary, not inside synchronous work): the kill test's
 * stand-in for an engine dying at that instant.
 */
function phaseReporter(params: {
	holdAt?: BenchPhase
}): (phase: BenchPhase) => void | Promise<void> {
	return function postPhase(phase) {
		workerScope.postMessage({ type: BENCH_PHASE_MESSAGE, phase })
		if (phase === params.holdAt) return new Promise((resolve) => setTimeout(resolve, KILL_HOLD_MS))
	}
}

function compareSignatures(params: {
	expected: Uint32Array
	actual: Uint32Array
}): OrderComparison {
	const { expected, actual } = params
	const length = Math.max(expected.length, actual.length)
	for (let index = 0; index < length; index++) {
		if (expected[index] !== actual[index])
			return { equal: false, records: actual.length, firstMismatch: index }
	}
	return { equal: true, records: actual.length, firstMismatch: -1 }
}

/** The file's elements in document order as order signatures, read with the parser's own options. */
async function sourceSignatures(params: {
	file: File
}): Promise<Array<{ signature: number; depth: number }>> {
	const parser = sax.parser(true, SAX_PARSER_OPTIONS)
	const out: Array<{ signature: number; depth: number }> = []
	const open: Array<{ index: number; tagName: string; values: string[]; value: string }> = []
	parser.onopentag = function sourceOpen(node) {
		const tag = node as sax.QualifiedTag
		open.push({
			index: out.length,
			tagName: tag.local,
			values: Object.values(tag.attributes).map((attribute) => attribute.value),
			value: '',
		})
		out.push({ signature: 0, depth: open.length - 1 })
	}
	parser.ontext = function sourceText(text) {
		const current = open.at(-1)
		if (current) current.value += readXmlTextRun({ text })
	}
	parser.oncdata = function sourceCdata(cdata) {
		const current = open.at(-1)
		if (current) current.value += cdata
	}
	parser.onclosetag = function sourceClose() {
		const element = open.pop()
		if (!element) return
		const slot = out[element.index]!
		slot.signature = recordSignature({
			depth: slot.depth,
			tagName: element.tagName,
			attributeValues: element.values,
			value: element.value,
		})
	}
	const reader = params.file.stream().pipeThrough(new TextDecoderStream()).getReader()
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
		parser.write(chunk.value)
	parser.close()
	return out
}

/** The source with the order check's commit inserted after the first root child's subtree. */
function expectedAfterEdits(params: {
	source: Array<{ signature: number; depth: number }>
	inserted: AnyRawRecord[]
	insertedDepths: number[]
}): Uint32Array {
	const { source, inserted, insertedDepths } = params
	let firstChildEnd = 2
	while (firstChildEnd < source.length && source[firstChildEnd]!.depth > 1) firstChildEnd += 1
	const insertedSignatures = inserted.map((record, index) =>
		recordSignature({
			depth: insertedDepths[index]!,
			tagName: record.tagName,
			attributeValues: record.attributes.map((attribute) => attribute.value),
			value: record.value,
		}),
	)
	return Uint32Array.from([
		...source.slice(0, firstChildEnd).map(({ signature }) => signature),
		...insertedSignatures,
		...source.slice(firstChildEnd).map(({ signature }) => signature),
	])
}

/** Consecutive root children from a third into the root, about `share` of the document's records. */
function pickSubtrees(params: { documentId: string; share: number; skipFirst: number }): {
	rootIds: string[]
	records: number
} {
	const { db, sink, roots } = requireOpened()
	const { documentId, share, skipFirst } = params
	const table = tableOf({ documentId })
	const children = sink.readChildren({ table, parentId: roots.get(documentId)! })
	const total = Number(db.selectValue(`SELECT count(*) FROM "${table}"`))
	const rootIds: string[] = []
	let records = 0
	for (
		let index = Math.max(skipFirst, Math.floor(children.length / 3));
		index < children.length - 1 && records < share * total;
		index++
	) {
		rootIds.push(children[index]!.id)
		records += sink.countSubtree({ table, rootId: children[index]!.id })
	}
	return { rootIds, records }
}

const api: BenchWorkerApi = {
	async open({ project, variant, cacheKiB, reportPhases, holdAtPhase }) {
		const startedAt = performance.now()
		const sqlite3 = await loadSqlite()
		const pool = await installPool({ sqlite3, project })
		const db = openDatabase({ pool, variant })
		const resolvedCacheKiB =
			cacheKiB ?? deviceCacheMiB({ deviceMemoryGiB: reportedDeviceMemoryGiB() }) * 1024
		const sink = createVariantSink({
			db,
			sqlite3Capi: sqlite3.capi,
			variant,
			cacheKiB: resolvedCacheKiB,
			onPhase: reportPhases ? phaseReporter({ holdAt: holdAtPhase }) : undefined,
		})
		opened = { sqlite3, pool, db, sink, variant, project, roots: new Map() }
		const sideTable = tableOf({ documentId: SIDE_DOCUMENT_ID })
		sink.createDocumentTable({ table: sideTable })
		const [sideRoot] = buildCommitRecords({ parentId: 'side-anchor', count: 1 })
		sink.commitCreates({
			table: sideTable,
			parentId: 'side-anchor',
			afterSiblingId: '',
			records: [sideRoot!],
		})
		await sink.finalizeImport({ table: sideTable })
		opened.roots.set(SIDE_DOCUMENT_ID, sideRoot!.id)
		return { openMs: performance.now() - startedAt, cacheKiB: resolvedCacheKiB }
	},

	importFile,

	async commitSmall({ documentId }) {
		const { sink, roots } = requireOpened()
		const table = tableOf({ documentId })
		const parentId = roots.get(documentId)!
		return sink.runOutsideWindow(function smallCommit() {
			const { totalMs } = sink.commitCreates({
				table,
				parentId,
				afterSiblingId: '',
				records: buildCommitRecords({ parentId, count: SMALL_COMMIT_RECORDS }),
			})
			return { commitMs: totalMs }
		})
	},

	async rootOf({ documentId }) {
		return requireOpened().roots.get(documentId)!
	},

	async commitRecords({ documentId, records }) {
		const { sink, roots } = requireOpened()
		const table = tableOf({ documentId })
		const rootId = roots.get(documentId)!
		const [first] = sink.readChildren({ table, parentId: rootId })
		return sink.runOutsideWindow(() =>
			sink.commitCreates({ table, parentId: rootId, afterSiblingId: first!.id, records }),
		)
	},

	async pickDeleteRoots({ documentId, share }) {
		return pickSubtrees({ documentId, share, skipFirst: 2 })
	},

	async deleteRoots({ documentId, rootIds }) {
		const steps = requireOpened().sink.deleteSubtrees({ table: tableOf({ documentId }), rootIds })
		return { ...steps, roots: rootIds.length }
	},

	async undo({ documentId }) {
		return requireOpened().sink.undo({ table: tableOf({ documentId }) })
	},

	async redo({ documentId }) {
		return requireOpened().sink.redo({ table: tableOf({ documentId }) })
	},

	async pickReadTargets({ documentId }) {
		const { db, sink, roots } = requireOpened()
		const table = tableOf({ documentId })
		const children = sink.readChildren({ table, parentId: roots.get(documentId)! })
		let best = { rootId: children[0]!.id, subtreeRecords: 0 }
		for (const child of children.slice(0, READ_TARGET_CANDIDATES)) {
			const size = sink.countSubtree({ table, rootId: child.id })
			if (
				Math.abs(size - READ_TARGET_RECORDS) < Math.abs(best.subtreeRecords - READ_TARGET_RECORDS)
			)
				best = { rootId: child.id, subtreeRecords: size }
		}
		const tags = db.selectArrays(`SELECT tagName, count(*) FROM "${table}" GROUP BY tagName`)
		const [tagName] = tags.reduce((closest, current) =>
			Math.abs(Number(current[1]) - READ_TARGET_RECORDS) <
			Math.abs(Number(closest[1]) - READ_TARGET_RECORDS)
				? current
				: closest,
		)
		return { ...best, tagName: String(tagName) }
	},

	async readTree({ documentId, rootId }) {
		const { sink } = requireOpened()
		return sink.runOutsideWindow(() => sink.readTree({ table: tableOf({ documentId }), rootId }))
	},

	async readByTagName({ documentId, tagName }) {
		const { sink } = requireOpened()
		return sink.runOutsideWindow(() =>
			sink.readByTagName({ table: tableOf({ documentId }), tagName }),
		)
	},

	async checkOrder({ documentId, file }) {
		const { sink, roots } = requireOpened()
		const table = tableOf({ documentId })
		const source = await sourceSignatures({ file })
		const afterImport = compareSignatures({
			expected: Uint32Array.from(source, ({ signature }) => signature),
			actual: sink.readOrderedSignatures({ table }),
		})
		const rootId = roots.get(documentId)!
		const [first] = sink.readChildren({ table, parentId: rootId })
		const inserted = buildCommitRecords({ parentId: rootId, count: ORDER_COMMIT_RECORDS })
		sink.commitCreates({ table, parentId: rootId, afterSiblingId: first!.id, records: inserted })
		const picked = pickSubtrees({ documentId, share: 0.05, skipFirst: 2 })
		sink.deleteSubtrees({ table, rootIds: picked.rootIds })
		sink.undo({ table })
		sink.redo({ table })
		sink.undo({ table })
		const expected = expectedAfterEdits({
			source,
			inserted,
			insertedDepths: depthsOf({ records: inserted, rootDepth: 1 }),
		})
		const afterEdits = compareSignatures({
			expected,
			actual: sink.readOrderedSignatures({ table }),
		})
		// one delete over two parents: a root child near the end and a grandchild under another root child
		const rootChildren = sink.readChildren({ table, parentId: rootId })
		const [grandchild] = sink.readChildren({ table, parentId: rootChildren[3]!.id })
		sink.deleteSubtrees({ table, rootIds: [rootChildren.at(-2)!.id, grandchild!.id] })
		sink.readOrderedSignatures({ table })
		sink.undo({ table })
		const afterMultiParent = compareSignatures({
			expected,
			actual: sink.readOrderedSignatures({ table }),
		})
		return { sourceRecords: source.length, afterImport, afterEdits, afterMultiParent }
	},

	async sizes() {
		const { db, project } = requireOpened()
		return databaseSizes({ db, project })
	},

	async removeDocument({ documentId }) {
		const { db, sink } = requireOpened()
		const startedAt = performance.now()
		sink.dropTable({ table: tableOf({ documentId }) })
		db.exec({ sql: 'DELETE FROM documents WHERE id = ?', bind: [documentId] })
		return { ms: performance.now() - startedAt }
	},

	async preparedDatabase({ project }) {
		const { sqlite3, db } = requireOpened()
		const exportStartedAt = performance.now()
		try {
			const bytes = sqlite3.capi.sqlite3_js_db_export(db)
			const exportMs = performance.now() - exportStartedAt
			const pool = await installPool({ sqlite3, project })
			const importStartedAt = performance.now()
			await pool.importDb(POOL_DATABASE_PATH, bytes)
			const importDbMs = performance.now() - importStartedAt
			const openStartedAt = performance.now()
			const prepared = new pool.OpfsSAHPoolDb(POOL_DATABASE_PATH)
			prepared.selectValue('SELECT count(*) FROM documents')
			prepared.close()
			const openMs = performance.now() - openStartedAt
			await pool.removeVfs()
			return { exportMs, importDbMs, openMs, bytes: bytes.byteLength }
		} catch (thrown) {
			return {
				exportMs: performance.now() - exportStartedAt,
				importDbMs: 0,
				openMs: 0,
				bytes: 0,
				error: thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown),
			}
		}
	},

	async reopenAfterKill({ project, otherDocumentId, variant }) {
		const sqlite3 = await loadSqlite()
		let pool: SAHPoolUtil
		let db: Database
		try {
			pool = await installPool({ sqlite3, project })
			db = new pool.OpfsSAHPoolDb(POOL_DATABASE_PATH)
		} catch (thrown) {
			return {
				opened: false,
				error: String(thrown),
				integrity: '',
				integrityAfterDrop: '',
				droppedImporting: 0,
			}
		}
		try {
			const integrity = String(db.selectValue('PRAGMA integrity_check'))
			const registry = db
				.selectArrays('SELECT id, status FROM documents')
				.map((row) => row.join(':'))
			const tables = db
				.selectArrays("SELECT name FROM sqlite_master WHERE type = 'table'")
				.map(([name]) => String(name))
			const importing = db.selectArrays(
				"SELECT id, tableName FROM documents WHERE status = 'importing'",
			)
			for (const [id, tableName] of importing) {
				db.exec(`DROP TABLE IF EXISTS "${String(tableName)}"`)
				db.exec({ sql: 'DELETE FROM documents WHERE id = ?', bind: [String(id)] })
			}
			const integrityAfterDrop = String(db.selectValue('PRAGMA integrity_check'))
			const tablesAfterSweep = db
				.selectArrays("SELECT name FROM sqlite_master WHERE type = 'table'")
				.map(([name]) => String(name))
			const sink = createVariantSink({
				db,
				sqlite3Capi: sqlite3.capi,
				variant,
				cacheKiB: deviceCacheMiB({ deviceMemoryGiB: reportedDeviceMemoryGiB() }) * 1024,
			})
			const otherSignatures = sink.readOrderedSignatures({
				table: tableOf({ documentId: otherDocumentId }),
			})
			opened = { sqlite3, pool, db, sink, variant, project, roots: new Map() }
			return {
				opened: true,
				integrity,
				integrityAfterDrop,
				droppedImporting: importing.length,
				registry,
				tables,
				tablesAfterSweep,
				otherSignatures,
			}
		} catch (thrown) {
			db.close()
			pool.pauseVfs()
			return {
				opened: true,
				error: String(thrown),
				integrity: 'error',
				integrityAfterDrop: 'error',
				droppedImporting: 0,
			}
		}
	},

	async exportSignatures({ documentId }) {
		const { sink } = requireOpened()
		return sink.readOrderedSignatures({ table: tableOf({ documentId }) })
	},

	async memory() {
		const sqlite3 = await loadSqlite()
		return { wasmBytes: sqlite3.wasm.heap8u().byteLength, ...(await realmMemory()) }
	},

	async destroy() {
		if (!opened) return
		opened.db.close()
		await opened.pool.removeVfs()
		opened = undefined
	},
}

/** Depth of each record of a pre-ordered subtree, its root at `rootDepth`. */
function depthsOf(params: { records: AnyRawRecord[]; rootDepth: number }): number[] {
	const depthById = new Map<string, number>()
	return params.records.map((record) => {
		const depth =
			record.parent && depthById.has(record.parent.id)
				? depthById.get(record.parent.id)! + 1
				: params.rootDepth
		depthById.set(record.id, depth)
		return depth
	})
}

async function databaseSizes(params: { db: Database; project: string }): Promise<DatabaseSizes> {
	const { db, project } = params
	const pageSize = Number(db.selectValue('PRAGMA page_size'))
	const pageCount = Number(db.selectValue('PRAGMA page_count'))
	const freelistCount = Number(db.selectValue('PRAGMA freelist_count'))
	const directory = await findDirectory({ path: ['bench', project] })
	const { usage, quota } = await navigator.storage.estimate()
	return {
		pageSize,
		pageCount,
		freelistCount,
		storageUsage: usage ?? -1,
		storageQuota: quota ?? -1,
		databaseBytes: pageSize * pageCount,
		opfsBytes: directory ? await directoryBytes({ directory }) : 0,
	}
}

Comlink.expose(api)
