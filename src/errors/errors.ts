import { ERROR_CATALOG } from './codes'

import type { DialecteErrorKey, DialecteErrorContext, DialecteCoreError } from './types'
import type { AnyDialecteConfig } from '@/types'

/**
 * Create a structured error with code, message, and context
 *
 * @param errorKey - Error key from ERROR_CATALOG (e.g., 'DATABASE_COMMIT_ERROR')
 * @param messageOverride - Optional custom message (uses default if not provided)
 * @param context - Context with method, currentFocus, operations, and custom props
 * @returns CoreError with all metadata
 *
 * @example
 * ```typescript
 * throw createError({
 *   errorKey: 'DATABASE_COMMIT_ERROR',
 *   context: {
 *     method: 'commit',
 *     currentFocus: apiRecord,
 *     operations: context.stagedOperations,
 *     creates: 5,
 *     updates: 3
 *   }
 * })
 * ```
 */
export function createError<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig>(params: {
	errorKey: DialecteErrorKey
	messageOverride?: string
	context: DialecteErrorContext<GenericConfig>
}): DialecteCoreError<GenericConfig> {
	const { errorKey, messageOverride, context } = params
	const { code, message: defaultMessage } = ERROR_CATALOG[errorKey]

	const error = new Error(messageOverride ?? defaultMessage) as DialecteCoreError<GenericConfig>
	error.code = code
	error.errorKey = errorKey
	error.defaultMessage = defaultMessage
	error.context = context

	return error
}

/**
 * Check if error is a CoreError
 */
export function isCoreError(error: unknown): error is DialecteCoreError {
	return error instanceof Error && 'code' in error && 'errorKey' in error
}
