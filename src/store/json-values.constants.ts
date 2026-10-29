/** How a refusal names a value of a type JSON has no form for. */
export const REFUSED_TYPES: Readonly<Record<'bigint' | 'function' | 'symbol', string>> = {
	bigint: 'a BigInt',
	function: 'a function',
	symbol: 'a symbol',
}

/**
 * The most arrays and objects a value handed to a store may nest, one in the other: well under
 * SQLite's JSON reader (1,000 levels, the row payload's own two included) and every engine's stack,
 * so every store refuses a deeper value alike, before anything is written.
 */
export const JSON_MAX_DEPTH = 512

/**
 * What a text holding a lone surrogate is not, in every refusal that names one (a stored value, a key,
 * a path).
 */
export const NOT_WELL_FORMED_TEXT = 'not well-formed UTF-16 (a lone surrogate)'

/** How the walk names a string value that is not well-formed. */
export const NOT_WELL_FORMED_VALUE_KIND = `text that is ${NOT_WELL_FORMED_TEXT}`

/** How the walk names an object key that is not well-formed (the key itself is not printed). */
export const NOT_WELL_FORMED_KEY_KIND = `a key that is ${NOT_WELL_FORMED_TEXT}`
