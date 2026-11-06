import type { ExportBenchFixtureName } from './export-bench.types'

/** The export budget per document size: 50 MB within 10 s, 500 MB within 2 min (half the import's: no hooks). */
export const EXPORT_BUDGET_MS = { 50: 10_000, 500: 120_000 } as const

/** Timed runs per 50 MB fixture (median); a 500 MB generated document runs once. */
export const EXPORT_BENCH_RUNS = 3

/** A timed run starts at a 1-minute load below this, after waiting up to `EXPORT_BENCH_QUIET_WAIT_MS`. */
export const EXPORT_BENCH_QUIET_LOAD = 8
export const EXPORT_BENCH_QUIET_WAIT_MS = 30 * 60_000

/** One bench test's ceiling: imports, runs and quiet waits included. */
export const EXPORT_BENCH_TIMEOUT_MS = 60 * 60_000

/** The 50 MB fixtures, read through the perf project's fixture command (record counts checked there). */
export const EXPORT_BENCH_FIXTURES: {
	name: ExportBenchFixtureName
	family: 'structural' | 'composed'
}[] = [
	{ name: 'structural-50', family: 'structural' },
	{ name: 'composed-50-compact', family: 'composed' },
]

/** The fixture also exported once from the local store (IndexedDB), for information: one read call is a transaction. */
export const EXPORT_BENCH_LOCAL_FIXTURE = EXPORT_BENCH_FIXTURES[1]!

/** The stages the instrumented run splits the export into (spans, and `export::write` a tally). */
export const EXPORT_STAGES = [
	'export',
	'export::read',
	'export::write',
	'export::assemble',
] as const

/**
 * The generated 500 MB documents: a binary tree 21 levels deep (4,194,303 records, half of them holding children,
 * as in the composed SCL file: one read call per such element), and the core test dialecte's own elements four levels
 * below its root, 46 children each (the export writes their required and fixed attributes and orders their children
 * by the dialecte's sequence).
 */
export const GENERATED_UNKNOWN_FAN_OUTS = Array.from({ length: 21 }, () => 2)
export const GENERATED_KNOWN_FAN_OUTS = [46, 46, 46, 46] as const
export const GENERATED_ATTRIBUTES = 3
export const GENERATED_VALUE_EVERY = 4
