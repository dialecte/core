/** A character XML does not count as whitespace, and whether JavaScript's `trim` drops it. */
export type NotXmlWhitespace = { character: string; javaScriptTrims: boolean }
