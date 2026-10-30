import { RECORD_COLUMNS } from '../engine/engine.constants'

import type { BenchFixtureName } from './bench-commands.types'
import type { BenchLayout, BenchPhase, BenchVariant, KillScenario } from './bench.types'

//====== RECORD TABLE ======//

/** The column that carries sibling order: the children list (L1) or the record's position (L2). */
export const RECORD_ORDER_COLUMN: Record<BenchLayout, string> = {
	'children-column': 'children',
	'derived-position': 'position',
}

/** The columns every layout stores, in binding order: the engine's, but its order column. */
export const RECORD_SHARED_COLUMNS = Object.keys(RECORD_COLUMNS).filter(
	(column) => column !== RECORD_ORDER_COLUMN['children-column'],
)

/** Each layout's columns with their SQL types: the engine's (L1), its order column swapped for the position (L2). */
export const RECORD_LAYOUT_COLUMNS: Record<BenchLayout, Record<string, string>> = {
	'children-column': RECORD_COLUMNS,
	'derived-position': {
		...Object.fromEntries(
			RECORD_SHARED_COLUMNS.map((column) => [
				column,
				RECORD_COLUMNS[column as keyof typeof RECORD_COLUMNS],
			]),
		),
		[RECORD_ORDER_COLUMN['derived-position']]: 'REAL',
	},
}

//====== ENGINE KNOBS ======//

export const WINDOW_TIME_CAP_MS = 1000
export const WINDOW_SIZE_CAP_BYTES = 32 * 1024 * 1024
/** The table and index names the engine builds (quoted, never escaped). */
export const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** SQLite's own default `cache_size`: 2000 KiB. */
export const SQLITE_DEFAULT_CACHE_PRAGMA = -2000
export const POOL_DATABASE_PATH = '/bench.sqlite3'
/** The `type` of the phase markers the worker posts besides Comlink's own messages. */
export const BENCH_PHASE_MESSAGE = 'bench-phase'
export const VFS_ERRORS_KEPT = 5
export const SIDE_DOCUMENT_ID = 'side'
/** Records a small commit writes into the side document. */
export const SMALL_COMMIT_RECORDS = 10
/** The deepClone-sized commit of the edit measures. */
export const COMMIT_CREATES_RECORDS = 100_000
/** Items per group in a created subtree. */
export const COMMIT_GROUP_ITEMS = 999
/** Records of the commit the order check makes between two root children. */
export const ORDER_COMMIT_RECORDS = 1_000
/** Share of the document the edit measures delete (whole root-child subtrees). */
export const EDIT_DELETE_SHARE = 0.1
/** Attribute the synthetic import session writes back, like a dialecte filling a uuid. */
export const AFTER_IMPORT_ATTRIBUTE = 'benchRef'

//====== PROTOCOL ======//

export const RUNS_PER_CELL = 3
export const CELL_TIMEOUT_MS = 6 * 60 * 60_000
export const DOCUMENT_ID = 'doc'
/** The document a kill test keeps intact next to the one it kills. */
export const OTHER_DOCUMENT_ID = 'other'
/** How the profiler finds the bench worker among the page's targets. */
export const WORKER_URL_PART = 'layout-bench.worker'
/** Functions whose self time the profile reports: the synthetic session's per-record hook and its build. */
export const PROFILED_FUNCTIONS = ['benchSessionBeforeRecord', 'benchSessionAfterImport']
/** The machine is shared: a run starts once the 1-minute load average is below this. */
export const QUIET_LOAD = 10
export const QUIET_WAIT_MAX_MS = 60 * 60_000
/** One load-wait command lasts at most this long (well under vitest's browser RPC timeout). */
export const QUIET_SLICE_MS = 20_000
/** Small commits from the page while an import runs, one every this many ms. */
export const SMALL_COMMIT_INTERVAL_MS = 1000
export const READ_REPEATS = 5
/** getTree reads the root child whose subtree is closest to this size (an IED-sized view); getByTagName the tag closest to it. */
export const READ_TARGET_RECORDS = 5000
export const READ_TARGET_CANDIDATES = 300
export const PROFILE_SAMPLING_INTERVAL_US = 1000
/** CPU-profile node names that are not the worker's work. */
export const PROFILE_IDLE_NODES = ['(idle)', '(program)']
export const PROFILE_GC_NODE = '(garbage collector)'
export const KILL_RUNS = 20
export const KILL_DELAY_MIN_MS = 1500
export const KILL_DELAY_SPREAD_MS = 2500
/** A kill test's worker holds this long at the phase its kill aims for. */
export const KILL_HOLD_MS = 500
/** The kill after a parse failure lands this long (at most) after the worker says it is dropping. */
export const KILL_AFTER_FAILURE_SPREAD_MS = 5
/** The parse failure happens between these shares of the records, so the drop has a table to work on. */
export const KILL_FAILURE_SHARE_MIN = 0.7
export const KILL_FAILURE_SHARE_SPREAD = 0.25
/**
 * At least this many kills must land where the scenario aims, or the test says nothing: in the
 * phase (the last marker the page saw, a lower bound) with the dead document still registered at
 * reopen (the kill came before its cleanup finished).
 */
export const KILL_MIN_IN_PHASE = 5
/** The phases (last marker seen by the page) a scenario's kill must land in to test anything. */
export const KILL_TARGET_PHASES: Record<KillScenario, ReadonlyArray<BenchPhase | 'none'>> = {
	'kill-after-spill': ['window-open'],
	'kill-after-parse-failure': ['dropping'],
}

/** The afterImport write-back of a file SET wrote (0) and of a file named by paths only (worst case). */
export const AFTER_IMPORT_RATIOS = { setWritten: 0, pathNamed: 0.107 } as const

//====== VARIANTS ======//

/**
 * The base variant: every other arm changes one dimension of it. Dimension ids (they key the recorded runs):
 * L1 children list as a JSON column / L2 children derived from parent id + REAL position;
 * I1 every index before the first insert / I2 lazy id index (at the first afterImport write), others at finalize;
 * J1 rollback journal (TRUNCATE) in the import window / J2 journal off in the window;
 * W1 window transactions capped at about 1 s of work / W2 capped at about 32 MB of rows;
 * V1 no auto-vacuum / V2 incremental auto-vacuum (pages given back after a drop).
 * The base is L1 · I2 · J1 · W1 · V1, device-sized import cache, the engine's steady cache (its device rule), JSON1 insert.
 */
export const BASE_VARIANT: BenchVariant = {
	id: 'base',
	layout: 'children-column',
	index: 'lazy-id',
	journal: 'truncate',
	window: { kind: 'time', ms: WINDOW_TIME_CAP_MS },
	vacuum: 'none',
	cache: 'device',
	steadyCache: 'engine',
	insert: 'json1',
}

export const VARIANTS = {
	base: BASE_VARIANT,
	L2: { ...BASE_VARIANT, id: 'L2', layout: 'derived-position' },
	I1: { ...BASE_VARIANT, id: 'I1', index: 'index-first' },
	J2: { ...BASE_VARIANT, id: 'J2', journal: 'off' },
	W2: { ...BASE_VARIANT, id: 'W2', window: { kind: 'size', bytes: WINDOW_SIZE_CAP_BYTES } },
	V2: { ...BASE_VARIANT, id: 'V2', vacuum: 'incremental' },
	/** No raise for the import: it runs on the 64 MiB steady cache the recorded runs of this arm used. */
	cacheDefault: {
		...BASE_VARIANT,
		id: 'cache-default',
		cache: 'default',
		steadyCache: { mib: 64 },
	},
	steadyDefault: { ...BASE_VARIANT, id: 'steady-default', steadyCache: 'default' },
	idFirst: { ...BASE_VARIANT, id: 'id-first', index: 'id-first' },
	perRow: { ...BASE_VARIANT, id: 'per-row', insert: 'per-row' },
	L2I1: { ...BASE_VARIANT, id: 'L2-I1', layout: 'derived-position', index: 'index-first' },
	/** Two arms together: id index up front, reclaimed space (the steady cache is the base's, device-sized). */
	combined: {
		...BASE_VARIANT,
		id: 'combined',
		index: 'id-first',
		vacuum: 'incremental',
	},
	/** id-first with a 0.5 s window cap: shorter waits for a commit during the import, at an import-time cost. */
	idFirstHalfWindow: {
		...BASE_VARIANT,
		id: 'id-first-w500',
		index: 'id-first',
		window: { kind: 'time', ms: WINDOW_TIME_CAP_MS / 2 },
	},
} as const satisfies Record<string, BenchVariant>

/**
 * The kill tests' variant: J2 (journal off in the import window, the id its recorded runs carry) with an
 * import cache this small that it spills inside every window, so the kill lands after a spill, and the
 * 64 MiB steady cache those runs used.
 */
export const KILL_VARIANT: BenchVariant = {
	...VARIANTS.J2,
	cache: { mib: 2 },
	steadyCache: { mib: 64 },
}

/** Caches above the device-sized ceiling: a 500 MB question only, kept out of the 50 MB list of every variant. */
export const CACHE_CEILING_VARIANTS = {
	/** The locked layout (L1 · I2 · J1 · W1 · V2 · JSON1) with both caches at 1,536 MiB: a 500 MB database fits whole. */
	bigCache1536: {
		...BASE_VARIANT,
		id: 'big-1536',
		vacuum: 'incremental',
		cache: { mib: 1536 },
		steadyCache: { mib: 1536 },
	},
	/** The same with 3,072 MiB, past the database size (and past what this sqlite-wasm build can grow to). */
	bigCache3072: {
		...BASE_VARIANT,
		id: 'big-3072',
		vacuum: 'incremental',
		cache: { mib: 3072 },
		steadyCache: { mib: 3072 },
	},
} as const satisfies Record<string, BenchVariant>

//====== MATRIX DIMENSIONS ======//

/** What a full cell measures beyond the import. */
export const ALL_MEASURES = {
	instrumented: true,
	edits: true,
	reads: true,
	removal: true,
} as const

export const BOTH_RATIOS = [AFTER_IMPORT_RATIOS.setWritten, AFTER_IMPORT_RATIOS.pathNamed]
/** The indented and compact inputs hold the same records: only the parse differs, so the indented arm runs the main dimensions. */
export const MAIN_DIMENSIONS = [VARIANTS.base, VARIANTS.L2, VARIANTS.I1, VARIANTS.J2]
export const STRUCTURAL: BenchFixtureName[] = ['structural-50', 'structural-100', 'structural-500']

//====== FIXTURES ======//

/** Root element and default namespace per fixture family (the bench config parses every element as unknown). */
export const FIXTURE_ROOTS = {
	composed: { rootElementName: 'SCL', namespaceUri: 'http://www.iec.ch/61850/2003/SCL' },
	structural: { rootElementName: 'Root', namespaceUri: 'http://dialecte.dev/XML/DEFAULT' },
} as const

/** The engine bench's timed runs start below this 1-minute load. */
export const ENGINE_BENCH_QUIET_LOAD = 8

/** One engine-bench cell's time limit: its wait for a quiet machine, then up to half an hour of work. */
export const ENGINE_BENCH_CELL_TIMEOUT_MS = QUIET_WAIT_MAX_MS + 30 * 60_000

/** The engine bench's database file in its pool. */
export const ENGINE_BENCH_DATABASE_PATH = '/engine-bench.sqlite3'

/** Records of the composed 500 MB compact file, the ready document of the engine-start cells. */
export const READY_500_RECORDS = 4_200_000

/** Rows written per transaction while the engine-start cells fill a document. */
export const FILL_ROWS_PER_TRANSACTION = 100_000

/** Random bytes per filled row's attribute value (written as hex: twice as many characters). */
export const FILL_ATTRIBUTE_BYTES = 120

/** The dead imports in front of the ready 500 MB document: a 50 MB file's records, and nine tenths of a 500 MB one. */
export const DEAD_IMPORT_ROWS = { 'dead-50': 486_333, 'dead-450': 3_780_000 } as const

/** The dialecte the engine bench's files say they belong to. */
export const ENGINE_BENCH_DIALECTE_ID = 'bench/engine'

/** How often another view commits while the engine bench's history cell imports (the budget: each lands within 2 s outside an index build). */
export const COMMIT_EVERY_MS = 250

/** The steady cache the history gate (a voltage level's delete, undo, redo each <= 5 s at 500 MB) was set at. */
export const GATE_STEADY_CACHE_MIB = 64

/** The tag whose largest subtree the history cell deletes. */
export const VOLTAGE_LEVEL_TAG = 'VoltageLevel'

/** The files of the engine bench's history-and-export cells, by the size in their cell's name. */
export const HISTORY_EXPORT_FIXTURES: Record<string, BenchFixtureName> = {
	'50': 'composed-50-compact',
	'500': 'composed-500-compact',
}

/** The port bench's files: the composed compact ones, by size. */
export const PORT_BENCH_FIXTURES: Record<string, BenchFixtureName> = {
	'50': 'composed-50-compact',
	'500': 'composed-500-compact',
}

/** How many times the port bench opens a pool, each way. */
export const POOL_OPEN_RUNS = 5

/** How often the start cell sends a read while the engine gives a dead import's pages back. */
export const RECLAIM_READ_EVERY_MS = 100

/** How long the start cell waits for the free pages to be back before it fails. */
export const RECLAIM_WAIT_MAX_MS = 120_000

/** Rounds of the export A/B: each exports once with the progress handler beating and once without. */
export const EXPORT_AB_ROUNDS = 5
