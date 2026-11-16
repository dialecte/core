import { XML_NAMESPACE } from './constant'

import type { Namespace } from '@/types'

/**
 * The namespace of a prefix that needs no declaration: the XML namespace for `xml`, bound in every document and
 * never declared; `undefined` for any other prefix, left to the dialecte's namespaces.
 *
 * @internal the one place the `xml` binding is written, for attribute names and QName values alike
 */
export function xmlNamespaceOf(prefix: string): Namespace | undefined {
	return prefix === XML_NAMESPACE.prefix ? XML_NAMESPACE : undefined
}
