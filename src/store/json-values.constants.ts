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
