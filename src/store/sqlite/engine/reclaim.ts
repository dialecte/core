import { yieldToQueue } from '@/utils/yield-to-queue'

import type { ReclaimParams } from './engine.types'

/**
 * Give the file's free pages back (incremental auto-vacuum) in whole statements of
 * `pagesPerStatement` pages, letting the queued calls run after every `sliceMs` of them: a large
 * removal never holds the engine for long. Each statement is a write of its own, made after the
 * running import's window is settled; the reclaim stops once the freelist is empty or the engine is
 * closed (what is left is given back by the next removal or start).
 */
export async function reclaimInSteps(params: ReclaimParams): Promise<void> {
	const { db, settle, isClosed, pagesPerStatement, sliceMs, onStep } = params
	let sliceStartedAt = performance.now()
	while (!isClosed() && freePagesOf({ db }) > 0) {
		settle()
		vacuumWhole({ db, pages: pagesPerStatement })
		// a step is a few virtual-machine steps a page: too few for SQLite's progress handler to beat
		onStep?.()
		if (performance.now() - sliceStartedAt < sliceMs) continue
		await yieldToQueue()
		sliceStartedAt = performance.now()
	}
}

/** How many pages of the file are free. */
export function freePagesOf(params: Pick<ReclaimParams, 'db'>): number {
	return Number(params.db.selectValue('PRAGMA freelist_count'))
}

/**
 * One reclaim statement, stepped to its end (each step gives one page back) and finalized: a statement
 * never outlives its step, so an import's window opened meanwhile never meets it.
 */
function vacuumWhole(params: { db: ReclaimParams['db']; pages: number }): void {
	const statement = params.db.prepare(`PRAGMA incremental_vacuum(${params.pages})`)
	try {
		while (statement.step());
	} finally {
		statement.finalize()
	}
}
