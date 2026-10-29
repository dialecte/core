import type { SqliteEngine } from '../engine/engine.types'
import type { BenchFixture, BenchFixtureName, GcShare } from './bench-commands.types'

/** The fixtures and the GC share are the node side's (`bench-commands.types.ts`); the pages read them from here too. */
export type { BenchFixture, BenchFixtureName, GcShare } from './bench-commands.types'
import type { BENCH_PHASE_MESSAGE } from './bench.constants'
import type { ImportPhase } from '@/store/store.types'
import type { AnyRawRecord, AnyRelationship, RecordPatch } from '@/types'
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

//====== VARIANTS ======//

/** L1 keeps each record's children as a JSON column; L2 derives them from the parent id and a position. */
export type BenchLayout = 'children-column' | 'derived-position'

/**
 * I1 builds every index before the first insert; I2 starts as a plain rowid table (id index at the
 * first non-create write, the others at finalize); `id-first` builds only the id index up front.
 */
export type BenchIndexTiming = 'index-first' | 'lazy-id' | 'id-first'

/** The rollback journal inside the import window: kept (TRUNCATE) or off. */
export type BenchJournal = 'truncate' | 'off'

/** When an import window transaction closes: after about `ms` of work or `bytes` of rows. */
export type BenchWindowCap = { kind: 'time'; ms: number } | { kind: 'size'; bytes: number }

/** `auto_vacuum` set at file creation. */
export type BenchVacuum = 'none' | 'incremental'

/** A cache size given in MiB, past the device-sized ceiling if need be. */
export type BenchCacheSize = { mib: number }

/** Page cache during an import: sized on the device's memory, no raise (the steady cache), or a size in MiB. */
export type BenchCache = 'device' | 'default' | BenchCacheSize

/** Page cache outside imports (commits, undo, reads): the engine's steady cache (its device rule), SQLite's default 2 MiB, or a size in MiB. */
export type BenchSteadyCache = 'engine' | 'default' | BenchCacheSize

/** One JSON1 bind per 1000 rows, or one prepared bind per row. */
export type BenchInsert = 'json1' | 'per-row'

export type BenchVariant = {
	id: string
	layout: BenchLayout
	index: BenchIndexTiming
	journal: BenchJournal
	window: BenchWindowCap
	vacuum: BenchVacuum
	cache: BenchCache
	steadyCache: BenchSteadyCache
	insert: BenchInsert
}

//====== INPUTS ======//

/** What a run measures beyond the import itself. */
export type BenchMeasures = {
	/** export order equals the source, after the import and after an edit/undo/redo round */
	order?: boolean
	/**
	 * one extra run after the timed ones: CPU profile of the worker (GC share, per-record hook) and
	 * small commits from the page while the import runs; kept out of the timed runs' numbers
	 */
	instrumented?: boolean
	/** the timed runs themselves commit from the page during the import (no profiler): commit latency over 3 runs */
	commitsDuringImport?: boolean
	/** 100K-record commit from the page, 10 % delete + undo + redo */
	edits?: boolean
	/** getTree of a subtree and getByTagNameInDocument through the port */
	reads?: boolean
	/** file size once the document is removed */
	removal?: boolean
	/** sqlite3_js_db_export -> importDb into a fresh pool */
	prepared?: boolean
}

/** One cell of the bench matrix: a variant on one input, run `runs` times. */
export type BenchCell = {
	id: string
	variant: BenchVariant
	fixture: BenchFixtureName
	afterImportRatio: number
	runs: number
	measures: BenchMeasures
	/** stop the import with a parse failure after this share of the records (failed-import size) */
	failAtShare?: number
}

//====== SINK ======//

/** The SQL a variant owns: DDL, inserts, updates and reads over one document table. */
export type VariantSink = {
	createDocumentTable: (params: { table: string }) => void
	writeCreates: (params: { table: string; records: AnyRawRecord[] }) => Promise<void>
	writeUpdates: (params: { table: string; patches: RecordPatch[] }) => Promise<void>
	finalizeImport: (params: { table: string }) => Promise<void>
	failImport: (params: { table: string }) => Promise<void>
	dropTable: (params: { table: string }) => void
	runOutsideWindow: <GenericResult>(work: () => GenericResult) => Promise<GenericResult>
	commitCreates: (params: CommitCreatesParams) => EditSteps
	deleteSubtrees: (params: { table: string; rootIds: string[] }) => EditSteps
	undo: (params: { table: string }) => EditSteps
	redo: (params: { table: string }) => EditSteps
	readTree: (params: { table: string; rootId: string }) => AnyRawRecord[]
	readChildren: (params: { table: string; parentId: string }) => AnyRelationship[]
	countSubtree: (params: { table: string; rootId: string }) => number
	readByTagName: (params: { table: string; tagName: string }) => AnyRawRecord[]
	readOrderedSignatures: (params: { table: string }) => Uint32Array
	timings: SinkTimings
}

export type CommitCreatesParams = {
	table: string
	parentId: string
	/** the sibling the new subtree goes after (insert-between) */
	afterSiblingId: string
	records: AnyRawRecord[]
}

/** One edit transaction's sub-steps (ms) and the records it touched. */
export type EditSteps = {
	records: number
	/** delete: subtree ids gathered; commit: siblings read and rows encoded */
	collectMs: number
	/** rows copied into the history (the undo snapshot) */
	historyMs: number
	/** rows inserted, deleted or restored */
	rowsMs: number
	/** the parent's children list rewritten (L1) */
	parentMs: number
	commitMs: number
	totalMs: number
}

/** The window state of an import: the open transaction and the work waiting for it to close. */
export type BenchWindowState = {
	open: boolean
	startedAt: number
	bytes: number
	waiters: Array<() => void>
}

/** A parent whose children list an edit changed (L1 only: L2 derives children from the rows). */
export type BenchParentChange = {
	parentId: string
	childrenBefore: AnyRelationship[]
	childrenAfter: AnyRelationship[]
}

/** One undoable change of the sink's history. */
export type BenchChangeEntry = {
	seq: number
	table: string
	kind: 'create' | 'delete'
	parents: BenchParentChange[]
}

/** Markers the worker posts to the page, so a kill test knows where its kill landed. */
export type BenchPhase = 'window-open' | 'window-committed' | 'failing' | 'dropping' | 'dropped'

/** Time spent in the sink during one import, by stage. */
export type SinkTimings = {
	encodeMs: number
	insertMs: number
	updateReadMs: number
	updateWriteMs: number
	windowCommitMs: number
	idIndexMs: number
	finalizeIndexMs: number
	yieldMs: number
	windows: number
	longestWindowMs: number
	rowsWritten: number
	/** stored rows the write-back changed (checked against the patches) */
	rowsPatched: number
}

//====== WORKER API ======//

export type OpenBenchPoolParams = {
	project: string
	variant: BenchVariant
	cacheKiB?: number
	/** post a message to the page at each window and drop phase (kill tests) */
	reportPhases?: boolean
	/** hold the worker at this phase so a kill lands there (kill tests) */
	holdAtPhase?: BenchPhase
}

/** The message a phase marker travels in. */
export type BenchPhaseMessage = { type: typeof BENCH_PHASE_MESSAGE; phase: BenchPhase }

export type ImportFileParams = {
	file: File
	documentId: string
	afterImportRatio: number
	/** throw a parse failure once this many records were created */
	failAfterRecords?: number
	root: FixtureRoot
}

/** Root element and default namespace of a fixture family. */
export type FixtureRoot = { rootElementName: string; namespaceUri: string }

export type ImportStageTimings = {
	/**
	 * residual: wall time of the parse loop minus the time in the sink and the afterImport build
	 * (stream read, decode, sax, standardize, record ids, the per-record session hook)
	 */
	parseMs: number
	/** the synthetic session's afterImport build (its per-record share is in the CPU profile) */
	hooksArmMs: number
	afterWritesMs: number
	finalizeMs: number
	totalWorkerMs: number
}

export type ImportFileResult = {
	records: number
	updates: number
	failed?: string
	stages: ImportStageTimings
	sink: SinkTimings
}

export type DatabaseSizes = {
	pageSize: number
	pageCount: number
	freelistCount: number
	/** `navigator.storage.estimate()` of the origin */
	storageUsage: number
	storageQuota: number
	databaseBytes: number
	opfsBytes: number
}

export type EditTimings = {
	/** the 100K-record commit timed from the page (records sent over the port) */
	commitCreates: EditSteps & { roundTripMs: number }
	deleteSubtrees: EditSteps & { roots: number; roundTripMs: number }
	undo: EditSteps & { roundTripMs: number }
	redo: EditSteps & { roundTripMs: number }
}

export type PreparedDatabaseTimings = {
	exportMs: number
	importDbMs: number
	openMs: number
	bytes: number
	error?: string
}

/** A small commit from the page during an import: in the worker, and as the page waited for it. */
export type SmallCommitResult = { commitMs: number; roundTripMs: number }

export type ReopenResult = {
	opened: boolean
	error?: string
	/** `PRAGMA integrity_check` as the kill left the file, then after the sweep dropped the dead document */
	integrity: string
	integrityAfterDrop: string
	droppedImporting: number
	/** the registry (`id:status`) and the tables the file held when it was reopened */
	registry?: string[]
	tables?: string[]
	tablesAfterSweep?: string[]
	otherSignatures?: Uint32Array
}

export type SubtreePick = { rootIds: string[]; records: number }

/** What the worker loads per opened pool. */
export type OpenedBenchPool = {
	sqlite3: Sqlite3Static
	pool: SAHPoolUtil
	db: Database
	sink: VariantSink
	variant: BenchVariant
	project: string
	/** each document's root record id */
	roots: Map<string, string>
}

/** The page's handle on one bench worker. */
export type SpawnedBenchWorker = { worker: Worker; api: BenchWorkerApi }

/** The bench worker's API, called over Comlink from the test page. */
export type BenchWorkerApi = {
	open: (params: OpenBenchPoolParams) => Promise<{ openMs: number; cacheKiB: number }>
	importFile: (params: ImportFileParams) => Promise<ImportFileResult>
	commitSmall: (params: { documentId: string }) => Promise<{ commitMs: number }>
	/** the created subtree goes in after the root's first child */
	commitRecords: (params: { documentId: string; records: AnyRawRecord[] }) => Promise<EditSteps>
	rootOf: (params: { documentId: string }) => Promise<string>
	/** whole root-child subtrees from a third of the way in, about `share` of the records (walks them: not timed) */
	pickDeleteRoots: (params: { documentId: string; share: number }) => Promise<SubtreePick>
	deleteRoots: (params: {
		documentId: string
		rootIds: string[]
	}) => Promise<EditSteps & { roots: number }>
	undo: (params: { documentId: string }) => Promise<EditSteps>
	redo: (params: { documentId: string }) => Promise<EditSteps>
	memory: () => Promise<BenchMemory>
	pickReadTargets: (params: {
		documentId: string
	}) => Promise<{ rootId: string; tagName: string; subtreeRecords: number }>
	readTree: (params: { documentId: string; rootId: string }) => Promise<AnyRawRecord[]>
	readByTagName: (params: { documentId: string; tagName: string }) => Promise<AnyRawRecord[]>
	checkOrder: (params: { documentId: string; file: File }) => Promise<OrderCheck>
	sizes: () => Promise<DatabaseSizes>
	removeDocument: (params: { documentId: string }) => Promise<{ ms: number }>
	preparedDatabase: (params: { project: string }) => Promise<PreparedDatabaseTimings>
	reopenAfterKill: (params: {
		project: string
		otherDocumentId: string
		variant: BenchVariant
	}) => Promise<ReopenResult>
	exportSignatures: (params: { documentId: string }) => Promise<Uint32Array>
	destroy: () => Promise<void>
}

export type OrderCheck = {
	sourceRecords: number
	afterImport: OrderComparison
	afterEdits: OrderComparison
	/** after a delete over two parents (a root child and a grandchild elsewhere) and its undo */
	afterMultiParent: OrderComparison
}

export type OrderComparison = { equal: boolean; records: number; firstMismatch: number }

//====== RUN RECORDS ======//

export type BenchDevice = {
	cpus: number
	cpuModel: string
	totalMemoryGiB: number
	platform: string
	osRelease: string
	browser: string
	browserVersion: string
	hardwareConcurrency: number
	deviceMemoryGiB: number | undefined
}

/** Memory of one realm at one point of a run; what the browser does not expose stays undefined. */
export type BenchMemory = {
	/** the sqlite3 WebAssembly.Memory buffer (worker only; wasm memory grows, it never shrinks) */
	wasmBytes?: number
	/** `performance.memory.usedJSHeapSize` (Chromium) */
	jsHeapUsedBytes?: number
	/** `performance.measureUserAgentSpecificMemory()`, or why it could not run */
	userAgentBytes?: number
	userAgentError?: string
}

/** The DOM lib lacks both: Chromium's `performance.memory` and the cross-origin-isolated user-agent measure. */
export type PerformanceWithMemory = Performance & {
	memory?: { usedJSHeapSize: number }
	measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
}

/** The worker's and the page's memory read at the same point of a run. */
export type BenchMemoryPoint = { worker: BenchMemory; page: BenchMemory }

/** Memory after the import, after the delete, and at the end of the run. */
export type BenchRunMemory = {
	afterImport?: BenchMemoryPoint
	afterDelete?: BenchMemoryPoint
	atEnd?: BenchMemoryPoint
}

export type BenchRun = {
	cell: string
	run: number
	/** the profiled run with commits during the import: its import timings are not the timed ones */
	instrumented: boolean
	variant: BenchVariant
	fixture: BenchFixture
	afterImportRatio: number
	loadBefore: number[]
	loadAfter: number[]
	waitedForQuietMs: number
	swapUsedMiB?: number
	device: BenchDevice
	dropToReadyMs: number
	recordsPerSecond: number
	importResult: ImportFileResult
	mainLongestTaskMs: number
	gc?: GcShare
	smallCommits?: SmallCommitResult[]
	sizesAfterImport?: DatabaseSizes
	edits?: EditTimings
	reads?: {
		getTreeMs: number[]
		treeRecords: number
		byTagMs: number[]
		byTagRecords: number
		tagName: string
	}
	order?: OrderCheck
	memory?: BenchRunMemory
	removal?: { removeMs: number; sizes: DatabaseSizes }
	prepared?: PreparedDatabaseTimings
	error?: string
}

export type KillScenario = 'kill-after-spill' | 'kill-after-parse-failure'

export type KillRun = {
	scenario: KillScenario
	run: number
	killedAfterMs: number
	/** the last marker the page had from the worker when it terminated it */
	phaseAtKill: BenchPhase | 'none'
	reopen: ReopenResult
	otherEqual: boolean
	load: number[]
}

/** The DOM lib (worker-only API) lacks it: enough to probe a pool file free. */
export type SyncAccessFileHandle = FileSystemFileHandle & {
	createSyncAccessHandle: () => Promise<{ close: () => void }>
}

//====== BROWSER COMMANDS ======//

export type BenchMachine = { load: number[]; swapUsedMiB?: number }
export type BenchNodeDevice = Omit<BenchDevice, 'hardwareConcurrency' | 'deviceMemoryGiB'>

declare module 'vitest/browser' {
	interface BrowserCommands {
		benchMachine: () => Promise<BenchMachine>
		benchWaitForQuiet: (params: {
			maxLoad: number
			maxWaitMs: number
		}) => Promise<{ waitedMs: number; load: number[] }>
		benchRecord: (params: { name: string; data: unknown }) => Promise<string>
		benchDevice: () => Promise<BenchNodeDevice>
		benchFixture: (params: { name: BenchFixtureName }) => Promise<BenchFixture>
		benchProfileStart: (params: {
			workerUrlIncludes: string
			samplingIntervalUs: number
		}) => Promise<void>
		benchProfileStop: (params: {
			gcNode: string
			idleNodes: string[]
			namedFunctions: string[]
		}) => Promise<GcShare>
	}
}

/** What a stage of an import took: its calls and its total, from the run's perf (spans and tallies alike). */
export type StageTiming = { calls: number; totalMs: number }

/** One import through the engine: drop to ready and its stages. */
export type EngineImportRun = {
	dropToReadyMs: number
	recordCount: number
	stages: Record<string, StageTiming>
	/** The database file's size once the document is ready (pages times page size). */
	databaseBytes: number
	/**
	 * The engine's signs of life during the import (beats as the runtime makes them, unthrottled): their
	 * count, the time told busy, the longest silences outside busy spans (from the import's start), and
	 * the import's phases on the same clock.
	 */
	liveness?: {
		beats: number
		busyMs: number
		longestGaps: { atMs: number; gapMs: number }[]
		phases?: PhaseChange[]
	}
}

/** A database file's pages, as SQLite counts them. */
export type FilePages = { pages: number; freePages: number; pageSize: number }

/** An engine start on a file holding a dead import in front of a ready document. */
export type EngineStartRun = {
	deadRows: number
	readyRows: number
	fillMs: { dead: number; ready: number }
	before: FilePages
	/** The engine's start as it runs: layout check, the dead import swept (its pages given back after, in steps). */
	startMs: number
	/** From the start until the last free page was given back. */
	reclaimMs: number
	/** Reads sent as messages every `RECLAIM_READ_EVERY_MS` while the pages were given back: each one's wait. */
	readWaits: { count: number; p50Ms: number; maxMs: number }
	/** The page cache the engine started with (the device's), in MiB. */
	cacheMiB: number
	after: FilePages
	/** A start on the file then (nothing left to sweep). */
	restartMs: number
}

/** A commit of another view while an import runs: when it was sent, how long until it resolved, whether an index build overlapped it. */
export type CommitDuringImport = {
	/** When it was sent, from the import's start (ms) */
	sentMs: number
	/** From sent to resolved, as the sending view sees it (ms) */
	waitMs: number
	/** Whether an index build of the import overlapped its wait */
	duringIndexing: boolean
}

/** The waits of the commits sent during an import, apart for those an index build overlapped. */
export type CommitWaits = {
	commits: number
	outsideIndexing: { count: number; p50Ms: number; maxMs: number }
	duringIndexing: { count: number; maxMs: number }
	/** Every commit, in the order sent */
	all: CommitDuringImport[]
}

/** A change of an import's phase, on the clock both realms share (`timeOrigin + now`, ms). */
export type PhaseChange = {
	atEpochMs: number
	phase: ImportPhase
}

/** An import of the history cell: its run, its document, its phase changes. */
export type HistoryImport = {
	run: EngineImportRun
	documentId: string
	startedAtEpochMs: number
	endedAtEpochMs: number
	phases: PhaseChange[]
}

/** A delete of a subtree by one commit, its undo and its redo, each timed through the engine. */
export type SubtreeEditRun = {
	/** The page cache the engine runs with (MiB) */
	cacheMiB: number
	records: number
	deleteMs: number
	undoMs: number
	redoMs: number
}

/** An export through the engine: its time, the file's size, its stages. */
export type EngineExportRun = {
	exportMs: number
	fileBytes: number
	recordCount: number
	stages: Record<string, StageTiming>
}

/** The engine's history and export cell on one file. */
export type EngineHistoryExportRun = {
	/** The file imported alone (no commit meanwhile), then removed */
	importAlone: EngineImportRun
	/** The file imported again while the page commits on another document every `COMMIT_EVERY_MS` */
	importWithCommits: EngineImportRun
	commitWaits: CommitWaits
	export: EngineExportRun
	/** The largest voltage level deleted, undone, redone: at the device's cache, then at the gate's 64 MiB */
	voltageLevel: { atDeviceCache: SubtreeEditRun; atGateCache: SubtreeEditRun }
}

/** What the history cell's calls share in the worker: one pool and one engine, the subtree its edits delete. */
export type HistoryCellState = {
	pool?: SAHPoolUtil
	opened?: { engine: SqliteEngine; db: Database }
	subtree?: { root: AnyRawRecord; ids: string[] }
}

/** The engine bench's worker: the engine on a real OPFS pool. */
export type EngineBenchWorkerApi = {
	importOnOpfs: (params: {
		file: File
		project: string
		root: FixtureRoot
		afterImportRatio: number
	}) => Promise<EngineImportRun>
	measureStart: (params: {
		project: string
		deadRows: number
		readyRows: number
	}) => Promise<EngineStartRun>
	/** The history cell's engine on a pool of its own (installed at the first call), at the device's cache or the one given. */
	historyOpen: (params: {
		project: string
		root: FixtureRoot
		afterImportRatio: number
		steadyCacheMiB?: number
	}) => Promise<void>
	historyImport: (params: { file: File; writeId: string }) => Promise<HistoryImport>
	historyRemove: (params: { documentId: string }) => Promise<void>
	/** A ready document `other` of one record, the one the page commits on. */
	historySeedOther: () => Promise<void>
	/** One commit on `other`, as another view's edit: its record's value set to `value`. */
	historyCommitOther: (params: { value: string }) => Promise<void>
	historyExport: (params: { documentId: string }) => Promise<EngineExportRun>
	/** The largest subtree of a tag found and kept for the edits; answers its record count. */
	historyFindSubtree: (params: { documentId: string; tagName: string }) => Promise<number>
	/** The kept subtree deleted by one commit, undone, redone. */
	historyEditSubtree: (params: { documentId: string }) => Promise<SubtreeEditRun>
	historyUndo: (params: { documentId: string }) => Promise<void>
	/** The engine closed, the pool removed. */
	historyClose: () => Promise<void>
	/** The history engine's SQLite progress handler beating (as the runtime installs it, to no port) or none. */
	historyProgressBeat: (params: { on: boolean }) => Promise<void>
}

/** One file imported once, then exported again and again in one session, the progress handler on and off in turn. */
export type ExportBeatAbRun = {
	importMs: number
	recordCount: number
	exports: { beat: boolean; exportMs: number }[]
}

/** The port bench on one file: the import alone and with another view committing, through the store's ports. */
export type PortCommitsRun = {
	recordCount: number
	/** The import alone, from the call to its answer on this page. */
	aloneMs: number
	stagesAlone: Record<string, StageTiming>
	/** The same import while the other view commits every `COMMIT_EVERY_MS`. */
	withCommitsMs: number
	stagesWithCommits: Record<string, StageTiming>
	commits: CommitWaits
	/** Opens of the file's pool once it holds the document, each by a new engine worker. */
	existingPool: PoolOpenRuns
}

/** Opens of a pool: by a new worker (probe, install, open), and closed then opened again in one worker. */
export type PoolOpenRuns = {
	openMs: number[]
	resumeMs: number[]
}
