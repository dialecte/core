import type { BENCH_PHASE_MESSAGE } from './bench.constants'
import type { AnyRawRecord, AnyRelationship, RecordPatch } from '@/types'
import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { CDPSession } from 'playwright'

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

/** Page cache outside imports (commits, undo, reads): the engine's steady cache, device-sized, SQLite's default 2 MiB, or a size in MiB. */
export type BenchSteadyCache = 'engine' | 'device' | 'default' | BenchCacheSize

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

export type BenchFixtureName =
	| 'composed-50-indented'
	| 'composed-50-compact'
	| 'composed-100-indented'
	| 'composed-100-compact'
	| 'composed-500-indented'
	| 'composed-500-compact'
	| 'composed-catalogue-small'
	| 'structural-50'
	| 'structural-100'
	| 'structural-500'

/** What the node side knows of a fixture file: where the browser fetches it, and its counts. */
export type BenchFixture = {
	name: BenchFixtureName
	url: string
	path: string
	bytes: number
	records: number
}

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

/** From the worker's CPU profile: GC self time over busy (non-idle) time, plus named functions' self time. */
export type GcShare = {
	gcMs: number
	busyMs: number
	idleMs: number
	sampledMs: number
	share: number
	named: Record<string, number>
	/** the functions with the most self time, worker-wide */
	top: Array<{ name: string; ms: number }>
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

/** The parts of a CDP `Profiler.stop` profile the GC share needs. */
export type BenchCpuProfile = {
	nodes: Array<{ id: number; callFrame: { functionName: string } }>
	samples: number[]
	timeDeltas: number[]
	startTime: number
	endTime: number
}

/** The page's CDP session and the worker session it relays to (auto-attach without flatten). */
export type BenchProfileState = {
	session: CDPSession
	workerSessionId: string
	nextId: number
	pending: Map<number, (message: { result?: unknown; error?: { message: string } }) => void>
}

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
