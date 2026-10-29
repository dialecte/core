import {
	XML_CARRIAGE_RETURN,
	XML_LINE_FEED,
	XML_SPACE,
	XML_TAB,
	XML_WHITESPACE_RUN,
} from './xml-whitespace.constants'

/**
 * `text` without the XML whitespace (space, tab, carriage return, line feed) at its start and end; every other
 * character is kept, those JavaScript's `trim` drops too (a no-break space, a byte order mark, U+2028...).
 */
export function trimXmlWhitespace(params: { text: string }): string {
	const { text } = params
	let start = 0
	let end = text.length
	while (start < end && isXmlWhitespace(text.charCodeAt(start))) start++
	while (end > start && isXmlWhitespace(text.charCodeAt(end - 1))) end--
	if (start === 0 && end === text.length) return text
	return text.slice(start, end)
}

/** `text` with each run of XML whitespace written as one space; every other character is kept. */
export function collapseXmlWhitespace(params: { text: string }): string {
	return params.text.replace(XML_WHITESPACE_RUN, ' ')
}

/**
 * A run of text between two markup events as core's XML reader keeps it: trimmed of XML whitespace, each inner run
 * of it written as one space. The indentation between elements is XML whitespace only: `''`, nothing to collapse.
 */
export function readXmlTextRun(params: { text: string }): string {
	const trimmed = trimXmlWhitespace({ text: params.text })
	if (!trimmed) return trimmed
	return collapseXmlWhitespace({ text: trimmed })
}

// One positional code unit, no params object: called for every character a trim scans, the per-character hot path
// of the import.
function isXmlWhitespace(codeUnit: number): boolean {
	return (
		codeUnit === XML_SPACE ||
		codeUnit === XML_LINE_FEED ||
		codeUnit === XML_TAB ||
		codeUnit === XML_CARRIAGE_RETURN
	)
}
