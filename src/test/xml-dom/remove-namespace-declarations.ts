import { XMLNS_NAMESPACE_URI } from './xml-dom.constants'

import type { XmlDomElement } from './xml-dom.types'

/** Remove every namespace declaration attribute of an element and its descendants; their namespaces stay. */
export function removeNamespaceDeclarations(params: { element: XmlDomElement }): void {
	const { element } = params
	const declarations = Array.from(element.attributes).filter(
		(attribute) => attribute.namespaceURI === XMLNS_NAMESPACE_URI,
	)
	for (const declaration of declarations) element.removeAttributeNode(declaration)
	for (const child of Array.from(element.children)) removeNamespaceDeclarations({ element: child })
}
