import type { NotXmlWhitespace } from './xml-whitespace.fixtures.types'

/**
 * Characters XML does not count as whitespace, each with whether JavaScript's `trim` drops it: most of them it does
 * (a vertical tab, a form feed, a no-break space, a byte order mark, U+2028, U+2029, U+3000, U+1680), U+0085 and
 * U+200B it keeps.
 */
export const NOT_XML_WHITESPACE: Readonly<Record<string, NotXmlWhitespace>> = {
	'a vertical tab': { character: '\u{B}', javaScriptTrims: true },
	'a form feed': { character: '\u{C}', javaScriptTrims: true },
	'a no-break space': { character: '\u{A0}', javaScriptTrims: true },
	'a byte order mark': { character: '\u{FEFF}', javaScriptTrims: true },
	'a line separator': { character: '\u{2028}', javaScriptTrims: true },
	'a paragraph separator': { character: '\u{2029}', javaScriptTrims: true },
	'an ideographic space': { character: '\u{3000}', javaScriptTrims: true },
	'an ogham space mark': { character: '\u{1680}', javaScriptTrims: true },
	'a next line': { character: '\u{85}', javaScriptTrims: false },
	'a zero-width space': { character: '\u{200B}', javaScriptTrims: false },
}
