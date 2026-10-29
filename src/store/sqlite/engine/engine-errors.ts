import { CAUSE_DEPTH } from './engine.constants'

import { createDialecteError, toDialecteError } from '@/errors'

import type { StoreFailureKey } from './engine.types'

/**
 * Run `work`; a failure of SQLite (or of anything but a refusal) is thrown as the operation's store
 * error, the failure as its `cause`. A refusal - a structured error - passes as it is.
 */
export function asStoreFailure<GenericResult>(params: {
	key: StoreFailureKey
	detail: string
	work: () => GenericResult
}): GenericResult {
	const { key, detail, work } = params
	try {
		return work()
	} catch (thrown) {
		throw toStoreFailure({ key, detail, thrown })
	}
}

/** A failure of SQLite as the operation's store error, the failure as its cause; a refusal stays as it is. */
export function toStoreFailure(params: {
	key: StoreFailureKey
	detail: string
	thrown: unknown
}): Error {
	const { key, detail, thrown } = params
	// a structured error is an Error carrying its record
	if (toDialecteError(thrown)) return thrown as Error
	const cause = thrown instanceof Error ? thrown : new Error(String(thrown))
	return createDialecteError(key, { detail: `${detail}: ${cause.message}`, cause })
}

/** A read: a failure of SQLite is thrown as `STORE_READ_FAILED`, `detail` naming what was read. */
export function asReadFailure<GenericResult>(params: {
	detail: string
	work: () => GenericResult
}): GenericResult {
	const { detail, work } = params
	return asStoreFailure({ key: 'STORE_READ_FAILED', detail: `${detail} could not be read`, work })
}

/** The primary SQLite result code a failure carries, its causes walked; none when SQLite raised none of it. */
export function sqliteCodeOf(params: { thrown: unknown }): number | undefined {
	let current: unknown = params.thrown
	for (
		let depth = 0;
		current !== null && typeof current === 'object' && depth < CAUSE_DEPTH;
		depth += 1
	) {
		const resultCode = (current as { resultCode?: unknown }).resultCode
		// an extended code keeps its primary code in its low byte
		if (typeof resultCode === 'number') return resultCode & 0xff
		current = (current as { cause?: unknown }).cause
	}
	return undefined
}
