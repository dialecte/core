import { RECORD_LINES_SAX_OPTIONS } from './conformance.constants'

import * as sax from 'sax'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { invariant } from '@/utils/invariant'

/**
 * The record id of each element, by the line where its start tag ends (the line libxml2 reports an element on).
 *
 * @throws when two element starts end on one line (naming the line), or an element carries no record id (naming it)
 */
export function recordIdsByLine(params: { document: string }): ReadonlyMap<number, string> {
	const { document: source } = params
	const idsByLine = new Map<number, string>()
	const parser = sax.parser(true, RECORD_LINES_SAX_OPTIONS)

	parser.onopentag = function mapStartTag(tag) {
		// sax counts lines from 0, and has just read the `>` that ends the start tag
		const line = parser.line + 1
		const id = tag.attributes[CUSTOM_RECORD_ID_ATTRIBUTE]
		invariant(typeof id === 'string' && id !== '', {
			detail: `recordIdsByLine: element '${tag.name}' on line ${line} carries no ${CUSTOM_RECORD_ID_ATTRIBUTE}`,
		})
		invariant(!idsByLine.has(line), {
			detail: `recordIdsByLine: two element starts end on line ${line} ('${idsByLine.get(line)}' and '${id}'): one per line`,
		})
		idsByLine.set(line, id)
	}

	parser.write(source).close()
	return idsByLine
}
