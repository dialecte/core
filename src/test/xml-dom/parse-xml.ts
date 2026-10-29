import { findWellFormednessError } from './find-well-formedness-error'
import { removeNodesOutsideTheDataModel } from './remove-nodes-outside-the-data-model'

import * as xmlDom from '@xmldom/xmldom'

import type { ParsedXml, XmlDomDocument } from './xml-dom.types'

/**
 * Parse XML text with the pure-JS XML DOM, strict as a browser's parser: text that is not well-formed (a strict
 * streaming parse, then the DOM's own checks, a warning included) is the answer's `error`. The document holds what
 * the DOM holds: no XML declaration node, no text around the root.
 */
export function parseXml(params: { xml: string }): ParsedXml {
	const { xml } = params
	const wellFormednessError = findWellFormednessError({ xml })
	if (wellFormednessError !== undefined) return { error: wellFormednessError }
	const problems: string[] = []
	const parser = new xmlDom.DOMParser({
		onError: function stopOnFirstProblem(_level, message) {
			problems.push(message)
			xmlDom.onWarningStopParsing()
		},
	})
	let document: XmlDomDocument
	try {
		document = parser.parseFromString(xml, xmlDom.MIME_TYPE.XML_APPLICATION)
	} catch (error) {
		return { error: problems[0] ?? (error as Error).message }
	}
	removeNodesOutsideTheDataModel({ document })
	return { document }
}
