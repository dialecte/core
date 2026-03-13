import { ERROR_CATALOG } from './codes'

import type { DialecteErrorKey } from './types'

/**
 * Create a structured error and throw it.
 * When `method` is omitted, the caller's name is extracted from the stack trace.
 *
 * Wraps the DialecteError in a real Error (for stack trace) and sets it as `.cause`
 * so `toDialecteError` can extract it in catch blocks.
 *
 * @example
 * throwDialecteError('ELEMENT_NOT_FOUND', { detail: 'parent not found' })
 */
export function throwDialecteError(
	key: DialecteErrorKey,
	params: {
		detail: string
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
		method: resolveCallerFromStack(new Error().stack),
		ref: params.ref,
		cause: params.cause,
	}
	const error = new Error(params.detail)
	error.cause = dialecteError
	throw error
}

function resolveCallerFromStack(stack: string | undefined): string {
	if (!stack) return 'unknown'
	// Skip internal frames (throwDialecteError, assert) to find the real caller
	const frame = stack
		.split('\n')
		.slice(1)
		.find((line) => !/\b(throwDialecteError|assert)\b/.test(line))

	if (!frame) return 'unknown'

	// Match: "  at funcName (file:line:col)"  or  "  at funcName (url?query:line:col)"
	const match = frame.match(/\bat\s+(\S+)\s+\(([^)]+)\)/)
	const funcName = match?.[1]
	const fileAndPos = match?.[2]

	if (!fileAndPos || !funcName) return funcName ?? 'unknown'

	// Extract "packageName/src/path/to/file.ts" from URL or absolute path
	const fileMatch = fileAndPos.match(/(\w[\w-]*\/src\/[^?:]+)/)
	if (!fileMatch) return funcName

	const filePath = fileMatch[1].replace(/\.[^/.]+$/, '') // strip extension

	return `${filePath}::${funcName}`
}
