import {
	IMPORT_PROCESSING_START_STEP,
	IMPORT_PROGRESS_INTERVAL_MS,
} from './import-progress.constants'

import { NOOP_PERF } from '@/perf'
import { tellListener } from '@/utils/tell-listener'
import { TOLD_OF } from '@/utils/tell-listener.constants'

import type {
	CreateImportReporterParams,
	ImportProgressReport,
	ImportReporter,
} from './import-progress.types'
import type { ImportProgress, ImportTarget, WriteSessionControl } from '@/store/store.types'

/**
 * The reporter of one file's import: every report told with the file's bytes, a counted report of a phase or step
 * held while `intervalMs` runs since the last one told (the last of a step, a new phase or step told at once, a
 * held report told before them), each phase and step of the dialecte's hook timed as `import::phase.<name>` and
 * `import::hook.<step>`. The listener is never awaited, its failure reported once for the import.
 */
export function createImportReporter(params: CreateImportReporterParams): ImportReporter {
	const {
		totalBytes,
		listener,
		perf = NOOP_PERF,
		intervalMs = IMPORT_PROGRESS_INTERVAL_MS,
		now = () => performance.now(),
		schedule = scheduleOnTimer,
	} = params
	// the import's reports: a listener failing at each one reported once
	const call = {}
	let bytesRead = 0
	let last: ImportProgress | undefined
	let lastToldAt = Number.NEGATIVE_INFINITY
	let held: ImportProgress | undefined
	let openPhase: string | undefined
	let openStep: string | undefined
	let closed = false
	let cancelFlush: (() => void) | undefined

	function tell(progress: ImportProgress): void {
		held = undefined
		cancelFlush?.()
		cancelFlush = undefined
		if (last && isSameProgress({ left: last, right: progress })) return
		last = progress
		lastToldAt = now()
		tellListener({ listener, value: progress, of: TOLD_OF.importProgress, call })
	}

	function openSpans(progress: ImportProgress): void {
		if (progress.phase !== openPhase) {
			closeStep()
			if (openPhase !== undefined) perf.stop(`import::phase.${openPhase}`)
			openPhase = progress.phase
			perf.start(`import::phase.${openPhase}`)
		}
		if (progress.phase !== 'processing' || progress.step === openStep) return
		closeStep()
		openStep = progress.step
		if (openStep !== IMPORT_PROCESSING_START_STEP) perf.start(`import::hook.${openStep}`)
	}

	function closeStep(): void {
		if (openStep !== undefined && openStep !== IMPORT_PROCESSING_START_STEP) {
			perf.stop(`import::hook.${openStep}`)
		}
		openStep = undefined
	}

	return {
		tell: function tellReport(report) {
			if (closed) return
			if (report.phase === 'storing') bytesRead = report.bytesRead
			const progress = withBytes({ report, bytesRead, totalBytes })
			// indexing happens within another phase (a store builds its indexes as it needs them): no span of its own here
			if (progress.phase !== 'indexing') openSpans(progress)
			const moved = !last || !isSameStage({ left: last, right: progress })
			if (moved && held) tell(held)
			if (moved || !isCounted(progress) || isCountDone(progress)) {
				tell(progress)
				return
			}
			const waited = now() - lastToldAt
			if (waited >= intervalMs) {
				tell(progress)
				return
			}
			held = progress
			// the report held is told once the interval runs out, whether or not another report comes
			cancelFlush ??= schedule({
				work: function flushHeld() {
					cancelFlush = undefined
					if (held) tell(held)
				},
				afterMs: intervalMs - waited,
			})
		},
		close: function closeReporter() {
			if (closed) return
			closed = true
			held = undefined
			cancelFlush?.()
			cancelFlush = undefined
			closeStep()
			if (openPhase !== undefined) perf.stop(`import::phase.${openPhase}`)
			openPhase = undefined
		},
	}
}

/** Run `work` after `afterMs` on a timer that keeps no process alive; answers how to cancel it. */
function scheduleOnTimer(params: { work: () => void; afterMs: number }): () => void {
	const timer = setTimeout(params.work, params.afterMs)
	;(timer as { unref?: () => void }).unref?.()
	return function cancelTimer() {
		clearTimeout(timer)
	}
}

/** The report as the listener hears it: with the bytes of the file read so far, out of its size. */
function withBytes(params: {
	report: ImportProgressReport
	bytesRead: number
	totalBytes: number
}): ImportProgress {
	const { report, bytesRead, totalBytes } = params
	return { ...report, bytesRead, totalBytes } as ImportProgress
}

/** Whether two reports are of one phase, and of one step of the hook. */
function isSameStage(params: { left: ImportProgress; right: ImportProgress }): boolean {
	const { left, right } = params
	if (left.phase !== right.phase) return false
	if (left.phase === 'processing' && right.phase === 'processing') return left.step === right.step
	if (left.phase === 'indexing' && right.phase === 'indexing') return left.index === right.index
	return true
}

/** A report whose count is told: a phase or a step of the hook that counts what it does. */
function isCounted(progress: ImportProgress): boolean {
	return 'done' in progress && progress.done !== undefined
}

/** A counted report at its total: the last of its phase or step. */
function isCountDone(progress: ImportProgress): boolean {
	return 'done' in progress && 'total' in progress && progress.done === progress.total
}

/** Whether two reports say the same thing. */
function isSameProgress(params: { left: ImportProgress; right: ImportProgress }): boolean {
	const { left, right } = params
	const leftEntries = Object.entries(left)
	return (
		leftEntries.length === Object.keys(right).length &&
		leftEntries.every(([key, value]) => (right as Record<string, unknown>)[key] === value)
	)
}

/** A store that writes the session's writes in one step tells them all written at once. */
export function tellSessionWritten(params: {
	ops: Parameters<ImportTarget['writeSession']>[1]
	control: WriteSessionControl | undefined
}): void {
	const { ops, control } = params
	const total = (ops.creates?.length ?? 0) + (ops.updates?.length ?? 0) + (ops.deletes?.length ?? 0)
	control?.onProgress?.({ done: total, total })
}
