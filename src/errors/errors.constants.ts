/** Where core's published docs live: an explanation's `docs` page is under it. */
export const CORE_DOCS_URL = 'https://dialecte.github.io/core'

/**
 * The functions that only raise or report an error: the method is the first frame that is none of
 * them. Matched on the function name only — a frame's file path may well contain one of these words.
 */
export const RAISING_FUNCTIONS = new Set([
	'throwDialecteError',
	'createDialecteError',
	'invariant',
	'reportFailure',
])
