import {
	XPATH_AXIS_SEPARATOR,
	XPATH_PREFIX_PATTERN,
	XPATH_STRING_LITERAL_PATTERN,
} from './xml-dom.constants'

import type { NamespaceResolver } from './xml-dom.types'

/**
 * The first prefix of an XPath expression that no namespace is bound to, `undefined` when every one is: a browser
 * refuses such an expression whatever the document, where the `xpath` package only fails on a step it reaches.
 */
export function findUnboundPrefix(params: {
	expression: string
	namespaceResolver: NamespaceResolver
}): string | undefined {
	const { expression, namespaceResolver } = params
	const nameTests = expression
		.replace(XPATH_STRING_LITERAL_PATTERN, '""')
		.replaceAll(XPATH_AXIS_SEPARATOR, ' ')
	for (const match of nameTests.matchAll(XPATH_PREFIX_PATTERN)) {
		const prefix = match[1]
		if (prefix !== undefined && namespaceResolver(prefix) === null) return prefix
	}
	return undefined
}
