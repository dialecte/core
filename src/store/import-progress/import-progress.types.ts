import type { Perf } from '@/perf'
import type { DistributiveOmit, ImportProgress } from '@/store/store.types'

/** What a step of the import tells its reporter: the progress without the bytes, `storing` with the bytes read. */
export type ImportProgressReport =
	| DistributiveOmit<Exclude<ImportProgress, { phase: 'storing' }>, 'bytesRead' | 'totalBytes'>
	| { phase: 'storing'; bytesRead: number }

/** Where one file's import tells how far it is. */
export type ImportReporter = {
	/** Tell a report: at once, or held while the interval runs (a counted report within one phase or step). */
	tell(report: ImportProgressReport): void
	/** Close the phase and step spans still open; a report held is dropped, nothing told after. */
	close(): void
}

export type CreateImportReporterParams = {
	/** The file's size: every report's `totalBytes` */
	totalBytes: number
	listener: ((progress: ImportProgress) => void) | undefined
	perf?: Perf
	/** Default `IMPORT_PROGRESS_INTERVAL_MS` */
	intervalMs?: number
	/** The clock the interval is measured on; default `performance.now` */
	now?: () => number
	/** Runs `work` once `afterMs` passed and answers how to cancel it; default a timer */
	schedule?: (params: { work: () => void; afterMs: number }) => () => void
}
