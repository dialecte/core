import { DOCUMENT_LEVEL_NODES_OUTSIDE_THE_DATA_MODEL } from './xml-dom.constants'

import type { XmlDomDocument } from './xml-dom.types'

/**
 * Remove from a parsed document the children the DOM and XPath do not have there: the XML declaration, which the
 * pure-JS DOM keeps as a processing instruction, and the line breaks around the root, which it keeps as text.
 */
export function removeNodesOutsideTheDataModel(params: { document: XmlDomDocument }): void {
	const { document } = params
	const outside = Array.from(document.childNodes).filter(function isOutside(node) {
		return DOCUMENT_LEVEL_NODES_OUTSIDE_THE_DATA_MODEL.some((matches) => matches(node))
	})
	for (const node of outside) document.removeChild(node)
}
