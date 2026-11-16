import { isQName } from './names'

import { xmlNamespaceOf } from '@/helpers/xml-namespace'
import { qualifiedNameOf } from '@/utils/qualified-name'

import type { AtomicValue, ParseAtomicParams } from './validate-value.types'

/**
 * A QName (or NOTATION) resolved through the namespaces in scope: the `xml` prefix is always bound, the empty one is
 * the default namespace (none when unbound). A prefix bound nowhere refuses the value. With `clarkNames` (a facet
 * value of the schema, a value in the form core stores) a Clark name `{uri}local` is read too, its local name an
 * NCName.
 */
export function parseQualifiedName(params: ParseAtomicParams): AtomicValue | undefined {
	const { lexical, namespaces, clarkNames } = params
	if (!(clarkNames && lexical.startsWith('{')) && !isQName(lexical)) return undefined
	const name = qualifiedNameOf({
		value: lexical,
		namespaceOf: (prefix) => xmlNamespaceOf(prefix)?.uri ?? namespaces(prefix),
	})
	return name === undefined ? undefined : { kind: 'qname', clark: name.clark }
}
