/**
 * Where the engine's console state lives on `globalThis`: one state for every copy of the seam a test runner
 * loads, since the engine binds the console writers of the first copy only.
 */
export const ENGINE_CONSOLE_STATE_KEY: unique symbol = Symbol.for(
	'@dialecte/core/test: the XML engine console',
)

/** The prefix libxml2 puts on the XPath diagnostics it writes. */
export const ENGINE_XPATH_DIAGNOSTIC_PREFIX = 'XPath error : '

/** How many lines a printed node keeps when the caller sets no cap. */
export const DEFAULT_PRINT_MAX_LINES = 200

/** The indentation of a printed node: one level per depth. */
export const PRINT_INDENT = '  '

/** How libxml2-wasm words an expression that does not compile, as opposed to one that fails while evaluated. */
export const ENGINE_COMPILE_FAILURE_PREFIX = 'Failed to compile'

/** How libxml2 words a prefix the namespaces do not bind. */
export const ENGINE_UNBOUND_PREFIX_REASON = 'Undefined namespace prefix'
