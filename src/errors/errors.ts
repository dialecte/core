import { ERROR_CATALOG } from './codes'

import type {
	CoreCatalogueCollisions,
	DialecteError,
	DialecteErrorCatalogInput,
	DialecteErrorDefinition,
	DialecteErrorDefinitions,
	DialecteErrorKey,
	KnownDialecteErrorKey,
	ThrowDialecteErrorParams,
} from './types'

/**
 * Create a structured error and throw it.
 * When `method` is omitted, the caller's name is extracted from the stack trace.
 *
 * Wraps the DialecteError in a real Error (for stack trace) and sets it as `.cause`
 * so `toDialecteError` can extract it in catch blocks.
 *
 * `key` is a key of the core catalogue, or an error a dialecte declared with `defineErrors`.
 *
 * @example
 * throwDialecteError('ELEMENT_NOT_FOUND', { detail: 'parent not found' })
 */
export function throwDialecteError(
	key: DialecteErrorKey | DialecteErrorDefinition,
	params: ThrowDialecteErrorParams,
): never {
	throw createDialecteError(key, params)
}

/**
 * Build the Error `throwDialecteError` throws, without throwing it — for a caller that reports an
 * error it caught instead of raising one.
 */
export function createDialecteError(
	key: DialecteErrorKey | DialecteErrorDefinition,
	params: ThrowDialecteErrorParams,
): Error {
	const entry = typeof key === 'string' ? { key, ...ERROR_CATALOG[key] } : key
	const dialecteError = {
		code: entry.code,
		key: entry.key,
		message: params.message ?? entry.message,
		detail: params.detail,
		method: resolveCallerFromStack(new Error().stack),
		ref: params.ref,
		meta: params.meta,
		cause: params.cause,
	}
	const error = new Error(params.detail)
	error.cause = dialecteError
	return error
}

/**
 * Declare the errors of a dialecte: each entry gets its property name as `key`, so it can be
 * passed wherever a core key is — `throwDialecteError`, `invariant`.
 *
 * @example
 * const ERRORS = defineErrors({ NAME_TAKEN: { code: 'X1001', message: 'The name is already taken' } })
 * invariant(isFree, { key: ERRORS.NAME_TAKEN, detail: '…', meta: { name } })
 */
export function defineErrors<const GenericCatalog extends DialecteErrorCatalogInput>(
	catalog: GenericCatalog & CoreCatalogueCollisions<GenericCatalog>,
): DialecteErrorDefinitions<GenericCatalog> {
	const definitions: Record<string, DialecteErrorDefinition> = {}
	const keyByCode = new Map<string, string>()

	for (const [key, entry] of Object.entries(catalog)) {
		if (Object.hasOwn(ERROR_CATALOG, key)) {
			throwDialecteError('ASSERTION_FAILED', {
				detail: `defineErrors: "${key}" is a key of the core catalogue`,
			})
		}
		if (CORE_CODES.has(entry.code)) {
			throwDialecteError('ASSERTION_FAILED', {
				detail: `defineErrors: "${key}" uses "${entry.code}", a code of the core catalogue`,
			})
		}
		const holder = keyByCode.get(entry.code)
		if (holder) {
			throwDialecteError('ASSERTION_FAILED', {
				detail: `defineErrors: "${key}" uses "${entry.code}", the code of "${holder}"`,
			})
		}

		keyByCode.set(entry.code, key)
		definitions[key] = { key, ...entry }
	}
	return definitions as DialecteErrorDefinitions<GenericCatalog>
}

const CORE_CODES = new Set<string>(Object.values(ERROR_CATALOG).map((entry) => entry.code))

/**
 * The structured error a caught value carries — thrown by `throwDialecteError` or `invariant` —
 * or nothing when it is any other error or value.
 */
export function toDialecteError(thrown: unknown): DialecteError | undefined {
	if (!(thrown instanceof Error)) return undefined

	const carried = thrown.cause as Partial<DialecteError> | undefined
	if (!carried || carried instanceof Error) return undefined
	if (typeof carried.key !== 'string' || typeof carried.code !== 'string') return undefined
	return carried as DialecteError
}

/**
 * Whether a structured error is one the caller knows: a key of the core catalogue, or an entry of
 * one of the catalogues named — same key, same code. Its `key` is then narrowed to those keys, so a
 * `switch` on it or a table read with it is checked again.
 *
 * @example
 * const error = toDialecteError(thrown)
 * if (error && isKnownDialecteError(error, { catalogues: [MY_ERRORS] })) sentences[error.key]
 */
export function isKnownDialecteError<
	const GenericCatalogues extends readonly DialecteErrorDefinitions<DialecteErrorCatalogInput>[],
>(
	error: DialecteError,
	params: { catalogues: GenericCatalogues },
): error is DialecteError<KnownDialecteErrorKey<GenericCatalogues>> {
	if (Object.hasOwn(ERROR_CATALOG, error.key)) return true
	return params.catalogues.some(
		(catalogue) => Object.hasOwn(catalogue, error.key) && catalogue[error.key]?.code === error.code,
	)
}

/**
 * The functions that only raise or report an error: the method is the first frame that is none of
 * them. Matched on the function name only — a frame's file path may well contain one of these words.
 */
const RAISING_FUNCTIONS = new Set([
	'throwDialecteError',
	'createDialecteError',
	'invariant',
	'reportFailure',
])

function resolveCallerFromStack(stack: string | undefined): string {
	if (!stack) return 'unknown'

	// Match: "  at funcName (file:line:col)", "  at funcName (url?query:line:col)", and a function
	// called under another property name: "  at Object.funcName [as alias] (file:line:col)"
	const frames = stack
		.split('\n')
		.slice(1)
		.map((line) => line.match(/\bat\s+(?:async\s+)?(\S+)(?:\s+\[as\s+[^\]]+\])?\s+\(([^)]+)\)/))
	const frame = frames.find((match) => !isRaisingFrame(match?.[1]))
	// a plain object as receiver says nothing: `Object.funcName` → `funcName`, `Document.x` is kept
	const funcName = frame?.[1]?.replace(/^Object\./, '')
	const fileAndPos = frame?.[2]

	if (!fileAndPos || !funcName) return funcName ?? 'unknown'

	// Extract "packageName/src/path/to/file.ts" from URL or absolute path
	const fileMatch = fileAndPos.match(/(\w[\w-]*\/src\/[^?:]+)/)
	if (!fileMatch) return funcName

	const filePath = fileMatch[1].replace(/\.[^/.]+$/, '') // strip extension

	return `${filePath}::${funcName}`
}

/** `Document.reportFailure` or `reportFailure` alike: the name after the last dot. */
function isRaisingFrame(funcName: string | undefined): boolean {
	if (!funcName) return false
	return RAISING_FUNCTIONS.has(funcName.slice(funcName.lastIndexOf('.') + 1))
}
