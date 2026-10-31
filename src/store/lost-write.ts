import { createDialecteError, toDialecteError } from '@/errors'

import type { LostWriteOutcome } from './lost-write.types'
import type { Store } from './store.types'

/** Whether a call was refused because its engine was lost (`STORE_ENGINE_LOST`): what became of it is not known. */
export function isEngineLost(params: { thrown: unknown }): boolean {
	return toDialecteError(params.thrown)?.key === 'STORE_ENGINE_LOST'
}

/** Whether a write was refused with its engine lost and is known not to have landed (`meta.outcome` `not-applied`). */
export function wasNotApplied(params: { thrown: unknown }): boolean {
	const error = toDialecteError(params.thrown)
	return error?.key === 'STORE_ENGINE_LOST' && error.meta?.outcome === 'not-applied'
}

/** A read after a lost write that fails too (the engine still out of reach): the refusal already says what happened. */
export function ignoreReadFailure(): void {}

/**
 * What became of a write refused `STORE_ENGINE_LOST`, asked once by its id (on the store's next engine, or its own
 * once it answers): `applied`, `not-applied`, `running` (its silent engine may still apply it), or `unknown` when
 * the ask itself fails. The write is never made again here.
 */
export async function outcomeAfterLoss(params: {
	store: Store
	writeId: string
}): Promise<LostWriteOutcome> {
	const { store, writeId } = params
	try {
		return await store.getWriteOutcome({ writeId })
	} catch {
		return 'unknown'
	}
}

/**
 * The refusal of a lost write, told what became of it: `STORE_ENGINE_LOST` again, its meta with the write's id and
 * `outcome` (and what else the caller adds), the refusal it came from as its cause.
 */
export function lostWriteError(params: {
	thrown: unknown
	writeId: string
	outcome: LostWriteOutcome
	meta?: Record<string, unknown>
}): Error {
	const { thrown, writeId, outcome, meta } = params
	const lost = toDialecteError(thrown)
	return createDialecteError('STORE_ENGINE_LOST', {
		detail: `${lost?.detail ?? 'The engine was lost'} - the write's outcome: ${outcome}`,
		meta: { ...lost?.meta, ...meta, writeId, outcome },
		cause: thrown instanceof Error ? thrown : undefined,
	})
}
