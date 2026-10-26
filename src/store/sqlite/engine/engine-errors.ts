import { throwDialecteError, toDialecteError } from '@/errors'

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
		if (toDialecteError(thrown)) throw thrown
		const cause = thrown instanceof Error ? thrown : new Error(String(thrown))
		throwDialecteError(key, { detail: `${detail}: ${cause.message}`, cause })
	}
}
