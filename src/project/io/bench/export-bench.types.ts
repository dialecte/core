import type { ExportSource } from '@/store/store.types'
import type { AnyDialecteConfig, Namespace } from '@/types'

/** A generated document's shape: children per element at each depth, and the dialecte whose elements it uses. */
export type GeneratedShape = {
	fanOuts: readonly number[]
	namespace: Namespace
	/** The elements of this config (its root, then each element's children); `L<depth>` unknown tags without one */
	config?: AnyDialecteConfig
}

/** What a generated source counts while it is read. */
export type GeneratedSourceStats = {
	getManyCalls: number
	recordsMade: number
	/** Time spent making records, ms */
	makeMs: number
}

export type GeneratedSource = {
	source: ExportSource
	stats: GeneratedSourceStats
	totalRecords: number
}

/**
 * The 50 MB fixtures the export bench reads, by the names the perf project's fixture command serves them under: a store
 * of any kind exports them.
 */
export type ExportBenchFixtureName = 'structural-50' | 'composed-50-compact'

/** One timed export of a fixture: its time, its bytes, and the machine load it started at. */
export type ExportBenchRun = { totalMs: number; bytes: number; machine: unknown }

/** The time of each export stage of one instrumented run, and the share no stage holds. */
export type ExportStageSplit = {
	stages: Record<string, { calls: number; totalMs: number }>
	unattributedMs: number
}
