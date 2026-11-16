import { isQName } from './names'

import { xmlNamespaceOf } from '@/helpers/xml-namespace'
import { xsiTypeNameOf } from '@/utils/xsi-type'

import type { AtomicValue, ParseAtomicParams } from './validate-value.types'

/**
 * A QName (or NOTATION) resolved through the namespaces in scope: the `xml` prefix is always bound, the empty one is
 * the default namespace (none when unbound). A prefix bound nowhere refuses the value. A facet value of the schema
 * is already its Clark name.
 */
export function parseQualifiedName(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical, namespaces, schemaLiteral } = params
	if (schemaLiteral && lexical.startsWith('{')) return { kind: 'qname', clark: lexical }
	if (!isQName(lexical)) return undefined
	const name = xsiTypeNameOf({
		value: lexical,
		namespaceOf: (prefix) => xmlNamespaceOf(prefix)?.uri ?? namespaces(prefix),
	})
	return name === undefined ? undefined : { kind: 'qname', clark: name.clark }
}
