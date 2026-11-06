import { RECORD_COLUMN_LIST } from '../engine/engine.constants'
import { openSqliteEngine } from '../engine/sqlite-engine'
import { inWriteTransaction } from '../engine/transaction'
import { loadSqlite } from '../load-sqlite'
import { installProgressBeat } from '../runtime/progress-beat'
import { PROGRESS_BEAT_OPS } from '../runtime/runtime.constants'
import { createHeartbeat, withOpaquePhases } from '../served/host/heartbeat'
import { ENGINE_HEARTBEAT_INTERVAL_MS } from '../served/host/host.constants'
import { createBenchImportRuntime, stagesOf } from './bench-import-session'
import { installPool } from './bench-pool'
import {
	ENGINE_BENCH_DATABASE_PATH,
	ENGINE_BENCH_DIALECTE_ID,
	FILL_ATTRIBUTE_BYTES,
	FILL_ROWS_PER_TRANSACTION,
	RECLAIM_READ_EVERY_MS,
	RECLAIM_WAIT_MAX_MS,
} from './bench.constants'

import * as Comlink from 'comlink'

import { TABLE_DOCUMENTS, TABLE_RECORD_PREFIX } from '@/store/store.constants'
import { yieldToQueue } from '@/utils/yield-to-queue'

import type { SqliteEngine, SqliteEngineOptions } from '../engine/engine.types'
import type { Heartbeat } from '../served/host/host.types'
import type {
	EngineBenchWorkerApi,
	EngineImportRun,
	EngineStartRun,
	FilePages,
	HistoryCellState,
	PhaseChange,
	SubtreeEditRun,
} from './bench.types'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { DocumentRecord, DocumentStatus } from '@/project/types'
import type { AnyRawRecord } from '@/types'
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * The engine bench's worker: the real engine on a real OPFS pool (sahpool needs a worker). Each call
 * installs its own pool and removes it after.
 */
const api: EngineBenchWorkerApi = {
	importOnOpfs: async function importOnOpfs({ file, project, root, afterImportRatio }) {
		const sqlite3 = await loadSqlite()
		const pool = await installPool({ sqlite3, project })
		try {
			const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
			// the engine's signs of life as the runtime installs them, timed instead of posted
			const signs = createSignRecorder()
			installProgressBeat({ sqlite3, db, heartbeat: signs.heartbeat, ops: PROGRESS_BEAT_OPS })
			const runtime = createBenchImportRuntime({ root, afterImportRatio })
			const engine = openSqliteEngine({
				sqlite3,
				db,
				dialecteId: ENGINE_BENCH_DIALECTE_ID,
				name: project,
				runtime: {
					...runtime,
					hooks: withOpaquePhases({ hooks: runtime.hooks, heartbeat: signs.heartbeat }),
				},
				onWork: signs.heartbeat.beat,
			})
			try {
				const startedAt = performance.now()
				const phases: PhaseChange[] = []
				const result = await engine.importFile(
					{ file, writeId: 'w-bench', clientId: 'bench' },
					function keepPhases(progress) {
						if (phases.at(-1)?.phase !== progress.phase) {
							phases.push({ phase: progress.phase, atEpochMs: performance.now() - startedAt })
						}
					},
				)
				const dropToReadyMs = performance.now() - startedAt
				const { pages, pageSize } = pagesOf({ db })
				return {
					dropToReadyMs,
					recordCount: result.recordCount,
					stages: stagesOf({ snapshot: result.perf }),
					databaseBytes: pages * pageSize,
					liveness: { ...signs.gaps({ since: startedAt }), phases },
				}
			} finally {
				engine.close()
			}
		} finally {
			await removePool({ pool })
		}
	},

	/**
	 * A dead import (an `importing` document without indexes, filled first) in front of a ready
	 * document (with its indexes): the engine starts again on the file and removes the dead one,
	 * then gives its pages back - each part timed as the engine runs it.
	 */
	measureStart: async function measureStart({ project, deadRows, readyRows }) {
		const sqlite3 = await loadSqlite()
		const pool = await installPool({ sqlite3, project })
		try {
			const fillMs = await fillFile({ sqlite3, pool, project, deadRows, readyRows })
			const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
			const before = pagesOf({ db })
			const startedAt = performance.now()
			const engine = openSqliteEngine({
				sqlite3,
				db,
				dialecteId: ENGINE_BENCH_DIALECTE_ID,
				name: project,
			})
			const startMs = performance.now() - startedAt
			try {
				const cacheMiB = -Number(db.selectValue('PRAGMA cache_size')) / 1024
				const reclaim = await readsUntilReclaimed({ engine, db, startedAt })
				const after = pagesOf({ db })
				engine.close()
				const restartMs = timed({
					work: function restart() {
						openSqliteEngine({
							sqlite3,
							db: new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH),
							dialecteId: ENGINE_BENCH_DIALECTE_ID,
							name: project,
						}).close()
					},
				})
				return {
					deadRows,
					readyRows,
					fillMs,
					before,
					startMs,
					cacheMiB,
					...reclaim,
					after,
					restartMs,
				}
			} finally {
				if (db.isOpen()) engine.close()
			}
		} finally {
			await removePool({ pool })
		}
	},

	historyOpen: async function historyOpen({ project, root, afterImportRatio, steadyCacheMiB }) {
		const sqlite3 = await loadSqlite()
		history.pool ??= await installPool({ sqlite3, project })
		if (history.opened?.db.isOpen()) history.opened.engine.close()
		history.opened = openBenchEngine({
			sqlite3,
			pool: history.pool,
			project,
			runtime: createBenchImportRuntime({ root, afterImportRatio }),
			options: steadyCacheMiB === undefined ? undefined : { steadyCacheMiB },
		})
	},

	historyImport: async function historyImport({ file, writeId }) {
		const { engine, db } = openedEngine()
		const phases: PhaseChange[] = []
		const startedAtEpochMs = epochNow()
		const result = await engine.importFile(
			{ file, writeId, clientId: 'bench' },
			function keepPhaseChanges(progress) {
				if (phases.at(-1)?.phase !== progress.phase)
					phases.push({ atEpochMs: epochNow(), phase: progress.phase })
			},
		)
		const endedAtEpochMs = epochNow()
		const { pages, pageSize } = pagesOf({ db })
		return {
			documentId: result.record.id,
			startedAtEpochMs,
			endedAtEpochMs,
			phases,
			run: {
				dropToReadyMs: endedAtEpochMs - startedAtEpochMs,
				recordCount: result.recordCount,
				stages: stagesOf({ snapshot: result.perf }),
				databaseBytes: pages * pageSize,
			},
		}
	},

	historyRemove: async function historyRemove({ documentId }) {
		await openedEngine().engine.removeDocument(documentId)
	},

	historySeedOther: async function historySeedOther() {
		const { engine } = openedEngine()
		await engine.registerDocument(benchDocument({ id: 'other', status: 'ready' }))
		await engine.commit({
			documentId: 'other',
			writeId: 'w-other-seed',
			creates: [otherRecord({ value: '0' })],
			updates: [],
			deletes: [],
		})
	},

	historyCommitOther: async function historyCommitOther({ value }) {
		await openedEngine().engine.commit({
			documentId: 'other',
			writeId: `w-other-${value}`,
			creates: [],
			updates: [otherRecord({ value })],
			deletes: [],
		})
	},

	historyExport: async function historyExport({ documentId }) {
		const { engine } = openedEngine()
		const startedAt = performance.now()
		const result = await engine.exportFile({ documentId, exportId: 'e-bench', clientId: 'bench' })
		return {
			exportMs: performance.now() - startedAt,
			fileBytes: result.file.size,
			recordCount: await engine.count(documentId),
			stages: stagesOf({ snapshot: result.perf }),
		}
	},

	historyProgressBeat: async function historyProgressBeat({ on }) {
		const { db } = openedEngine()
		const sqlite3 = await loadSqlite()
		if (on) {
			installProgressBeat({
				sqlite3,
				db,
				heartbeat: createHeartbeat({ intervalMs: ENGINE_HEARTBEAT_INTERVAL_MS }),
				ops: PROGRESS_BEAT_OPS,
			})
		} else {
			sqlite3.capi.sqlite3_progress_handler(db, 0, 0, 0)
		}
	},

	historyFindSubtree: async function historyFindSubtree({ documentId, tagName }) {
		history.subtree = await largestSubtree({ engine: openedEngine().engine, documentId, tagName })
		return history.subtree.ids.length
	},

	historyEditSubtree: async function historyEditSubtree({ documentId }) {
		if (!history.subtree) throw new Error('no subtree found yet')
		return editSubtree({ ...openedEngine(), documentId, subtree: history.subtree })
	},

	historyUndo: async function historyUndo({ documentId }) {
		await openedEngine().engine.undo(documentId)
	},

	historyClose: async function historyClose() {
		if (history.opened?.db.isOpen()) history.opened.engine.close()
		if (history.pool) await removePool({ pool: history.pool })
		history.opened = undefined
		history.pool = undefined
		history.subtree = undefined
	},
}

Comlink.expose(api)

/** What the history cell's calls share: one pool and one engine, the subtree its edits delete. */
const history: HistoryCellState = {}

/**
 * The engine's signs of life, timed: every beat the work makes (unthrottled), and the busy spans told
 * around dialecte code; `gaps` answers the longest silences outside busy spans, from `since`.
 */
function createSignRecorder(): {
	heartbeat: Heartbeat
	gaps: (params: { since: number }) => NonNullable<EngineImportRun['liveness']>
} {
	const beats: number[] = []
	const busy: { from: number; to: number }[] = []
	let busySince: number | undefined
	function beat(): void {
		const now = performance.now()
		beats.push(now)
		if (busySince !== undefined) {
			busy.push({ from: busySince, to: now })
			busySince = undefined
		}
	}
	return {
		heartbeat: {
			add: function ignorePort() {},
			remove: function ignorePort() {},
			beat,
			idle: beat,
			busy: function markBusy() {
				beats.push(performance.now())
				busySince = performance.now()
			},
		},
		gaps: function gapsOf({ since }) {
			const silences = beats
				.slice(1)
				.map((at, index) => ({ atMs: beats[index]! - since, gapMs: at - beats[index]! }))
				.filter(
					({ atMs, gapMs }) =>
						!busy.some(({ from, to }) => from - since <= atMs && to - since >= atMs + gapMs),
				)
				.sort((left, right) => right.gapMs - left.gapMs)
			return {
				beats: beats.length,
				busyMs: busy.reduce((total, { from, to }) => total + to - from, 0),
				longestGaps: silences.slice(0, 5),
			}
		},
	}
}

/**
 * While the engine gives the dead import's pages back in steps: a read sent every
 * `RECLAIM_READ_EVERY_MS` as a message (as a view's call arrives), each one's wait from when it was due
 * to answered; and when the last free page was given back, from the start (within `RECLAIM_WAIT_MAX_MS`).
 */
async function readsUntilReclaimed(params: {
	engine: SqliteEngine
	db: Database
	startedAt: number
}): Promise<Pick<EngineStartRun, 'reclaimMs' | 'readWaits'>> {
	const { engine, db, startedAt } = params
	const channel = new MessageChannel()
	const waits: number[] = []
	const firstDueAt = performance.now()
	let sent = 0
	channel.port1.onmessage = async function answerRead(event: MessageEvent<number>) {
		await engine.getDocuments()
		// from when the read was due: a timer in this realm may fire late behind the reclaim's turns
		waits.push(performance.now() - event.data)
	}
	const timer = setInterval(function sendReadsDue() {
		// every read due since the last tick, each with its due time: a late tick sends the ones it missed
		while (firstDueAt + sent * RECLAIM_READ_EVERY_MS <= performance.now()) {
			channel.port2.postMessage(firstDueAt + sent * RECLAIM_READ_EVERY_MS)
			sent += 1
		}
	}, RECLAIM_READ_EVERY_MS)
	const deadline = performance.now() + RECLAIM_WAIT_MAX_MS
	let reclaimMs: number
	try {
		while (Number(db.selectValue('PRAGMA freelist_count')) > 0) {
			if (performance.now() > deadline) {
				throw new Error(`the free pages were not back after ${RECLAIM_WAIT_MAX_MS} ms`)
			}
			await yieldToQueue()
		}
		reclaimMs = performance.now() - startedAt
		clearInterval(timer)
		// the reads still on their way are answered too: the slowest ones are often the last
		while (waits.length < sent) await yieldToQueue()
	} finally {
		clearInterval(timer)
		channel.port1.close()
	}
	const sorted = [...waits].sort((left, right) => left - right)
	return {
		reclaimMs,
		readWaits: {
			count: sorted.length,
			p50Ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
			maxMs: sorted.at(-1) ?? 0,
		},
	}
}

function openedEngine(): { engine: SqliteEngine; db: Database } {
	if (!history.opened?.db.isOpen()) throw new Error('the history cell has no engine open')
	return history.opened
}

/** The time on the clock every realm of the page shares. */
function epochNow(): number {
	return performance.timeOrigin + performance.now()
}

function openBenchEngine(params: {
	sqlite3: Sqlite3Static
	pool: SAHPoolUtil
	project: string
	runtime: StoreRuntime
	options?: Partial<SqliteEngineOptions>
}): { engine: SqliteEngine; db: Database } {
	const { sqlite3, pool, project, runtime, options } = params
	const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
	const engine = openSqliteEngine({
		sqlite3,
		db,
		dialecteId: ENGINE_BENCH_DIALECTE_ID,
		name: project,
		runtime,
		options,
	})
	return { engine, db }
}

function otherRecord(params: { value: string }): AnyRawRecord {
	return {
		id: 'o1',
		tagName: 'Other',
		namespace: { prefix: '', uri: '' },
		attributes: [],
		value: params.value,
		parent: null,
		children: [],
	}
}

/** The subtree of the record of that tag holding the most records: its root and every id under it, level by level. */
async function largestSubtree(params: {
	engine: SqliteEngine
	documentId: string
	tagName: string
}): Promise<{ root: AnyRawRecord; ids: string[] }> {
	const { engine, documentId, tagName } = params
	let largest: { root: AnyRawRecord; ids: string[] } | undefined
	for (const root of await engine.getByTagNameInDocument(tagName, documentId)) {
		const ids = [root.id]
		let level = root.children.map((child) => child.id)
		while (level.length > 0) {
			ids.push(...level)
			const records = await engine.getMany(level, documentId)
			level = records.flatMap((record) => record?.children.map((child) => child.id) ?? [])
		}
		if (!largest || ids.length > largest.ids.length) largest = { root, ids }
	}
	if (!largest) throw new Error(`no ${tagName} in the document`)
	return largest
}

/** The subtree deleted by one commit (its ids, its parent without it), then undone, then redone. */
async function editSubtree(params: {
	engine: SqliteEngine
	db: Database
	documentId: string
	subtree: { root: AnyRawRecord; ids: string[] }
}): Promise<SubtreeEditRun> {
	const { engine, db, documentId, subtree } = params
	const parentId = subtree.root.parent?.id
	if (!parentId) throw new Error('the subtree has no parent')
	const parent = await engine.get(parentId, documentId)
	if (!parent) throw new Error(`the parent ${parentId} is not in the document`)
	const updated = {
		...parent,
		children: parent.children.filter((child) => child.id !== subtree.root.id),
	}
	const deleteMs = await timedAsync({
		work: () =>
			engine.commit({
				documentId,
				writeId: `w-delete-${crypto.randomUUID()}`,
				creates: [],
				updates: [updated],
				deletes: subtree.ids,
			}),
	})
	const undoMs = await timedAsync({ work: () => engine.undo(documentId) })
	const redoMs = await timedAsync({ work: () => engine.redo(documentId) })
	return {
		cacheMiB: -Number(db.selectValue('PRAGMA cache_size')) / 1024,
		records: subtree.ids.length,
		deleteMs,
		undoMs,
		redoMs,
	}
}

async function timedAsync(params: { work: () => Promise<unknown> }): Promise<number> {
	const startedAt = performance.now()
	await params.work()
	return performance.now() - startedAt
}

function benchDocument(params: { id: string; status: DocumentStatus }): DocumentRecord {
	return {
		id: params.id,
		name: params.id,
		extension: '.scd',
		configKey: 'default',
		createdAt: Date.now(),
		status: params.status,
	}
}

function tableOf(params: { db: Database; documentId: string }): string {
	const { db, documentId } = params
	const seq = db.selectValue(`SELECT seq FROM ${TABLE_DOCUMENTS} WHERE id = ?`, [documentId])
	return `${TABLE_RECORD_PREFIX}${seq}`
}

/**
 * Rows shaped like imported records (an id, a parent, one attribute of `FILL_ATTRIBUTE_BYTES` random
 * bytes as hex), written by SQLite itself, `FILL_ROWS_PER_TRANSACTION` per transaction.
 */
function fillRows(params: {
	sqlite3: Sqlite3Static
	db: Database
	table: string
	rows: number
	prefix: string
}): void {
	const { sqlite3, db, table, rows, prefix } = params
	for (let first = 1; first <= rows; first += FILL_ROWS_PER_TRANSACTION) {
		const last = Math.min(rows, first + FILL_ROWS_PER_TRANSACTION - 1)
		inWriteTransaction({
			sqlite3,
			db,
			work: function fillBatch() {
				db.exec({
					sql:
						'WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i + 1 FROM n WHERE i < ?) ' +
						`INSERT INTO ${table} (${RECORD_COLUMN_LIST}) ` +
						`SELECT printf('${prefix}%09d', i), 'T', '', 'u', '', printf('${prefix}%09d', i / 8), 'T', ` +
						`json_array(json_object('name', 'a', 'value', hex(randomblob(${FILL_ATTRIBUTE_BYTES})))), '[]' FROM n`,
					bind: [first, last],
				})
			},
		})
	}
}

function pagesOf(params: { db: Database }): FilePages {
	const { db } = params
	return {
		pages: Number(db.selectValue('PRAGMA page_count')),
		freePages: Number(db.selectValue('PRAGMA freelist_count')),
		pageSize: Number(db.selectValue('PRAGMA page_size')),
	}
}

function timed(params: { work: () => void }): number {
	const startedAt = performance.now()
	params.work()
	return performance.now() - startedAt
}

/**
 * The file of an engine-start cell: a dead import (an `importing` document whose table has no index
 * yet, as an import leaves it before its id index) filled first, then a ready document with its
 * indexes; the engine that wrote them closed. Answers how long each fill took.
 */
async function fillFile(params: {
	sqlite3: Sqlite3Static
	pool: SAHPoolUtil
	project: string
	deadRows: number
	readyRows: number
}): Promise<{ dead: number; ready: number }> {
	const { sqlite3, pool, project, deadRows, readyRows } = params
	const db = new pool.OpfsSAHPoolDb(ENGINE_BENCH_DATABASE_PATH)
	const engine = openSqliteEngine({
		sqlite3,
		db,
		dialecteId: ENGINE_BENCH_DIALECTE_ID,
		name: project,
	})
	try {
		const deadStartedAt = performance.now()
		await engine.registerDocument(benchDocument({ id: 'dead', status: 'importing' }))
		const deadTable = tableOf({ db, documentId: 'dead' })
		db.exec(`DROP INDEX ${deadTable}_id; DROP INDEX ${deadTable}_tag;`)
		fillRows({ sqlite3, db, table: deadTable, rows: deadRows, prefix: 'd' })
		const readyStartedAt = performance.now()
		await engine.registerDocument(benchDocument({ id: 'ready', status: 'ready' }))
		fillRows({
			sqlite3,
			db,
			table: tableOf({ db, documentId: 'ready' }),
			rows: readyRows,
			prefix: 'r',
		})
		return { dead: readyStartedAt - deadStartedAt, ready: performance.now() - readyStartedAt }
	} finally {
		engine.close()
	}
}

/** The run's pool gone with its files: the next run starts on an empty one. */
async function removePool(params: { pool: SAHPoolUtil }): Promise<void> {
	await params.pool.removeVfs()
}
