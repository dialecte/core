import { ERROR_CATALOG } from './codes'

import type { DialecteErrorKey } from './types'

/**
 * Create a structured error and throw it.
 *
 * Wraps the DialecteError in a real Error (for stack trace) and sets it as `.cause`
 * so `toDialecteError` can extract it in catch blocks.
 *
 * @example
 * throwDialecteError('ELEMENT_NOT_FOUND', { detail: 'parent not found', method: 'addChild' })
 */
export function throwDialecteError(
	key: DialecteErrorKey,
	params: {
		detail: string
		method: string
		message?: string
		ref?: { tagName: string; id?: string }
		cause?: Error
	},
): never {
	const entry = ERROR_CATALOG[key]
	const dialecteError = {
		code: entry.code,
		key,
		message: params.message ?? entry.message,
		detail: params.detail,
		method: params.method,
		ref: params.ref,
		cause: params.cause,
	}
	const error = new Error(params.detail)
	error.cause = dialecteError
	throw error
}
