import type { ParseOptions } from 'libxml2-wasm'

/**
 * The text is read as UTF-8 whatever its XML declaration says: a JS string reaches the engine as UTF-8. (A node
 * keeps its line up to 65535 only, whatever the parse options: the engine stores it in 16 bits.)
 */
export const XML_PARSE_OPTIONS: ParseOptions = { encoding: 'utf-8' }
