import { trimXmlWhitespace } from './xml-whitespace'

import { isNCName } from '@/validation/value/names'

import type { NamespaceLookup, QualifiedName } from './qname-value.types'

/**
 * The name a QName value names, read with `namespaceOf`: `prefix:local`, `local` (the default namespace, none when
 * no default is bound) or a Clark name `{uri}local` (`{}local` in no namespace), whose local name is an NCName.
 * `undefined` when its prefix is bound nowhere or it names no local name (`p:`, `{uri}`, `{uri}a b`, empty).
 */
export function qualifiedNameOf(params: {
	value: string
	namespaceOf: NamespaceLookup
}): QualifiedName | undefined {
	const { namespaceOf } = params
	// a QName collapses XML whitespace only: a no-break space is part of the name
	const value = trimXmlWhitespace({ text: params.value })
	if (value.startsWith('{')) {
		const closing = value.indexOf('}')
		const local = closing === -1 ? '' : value.slice(closing + 1)
		if (!isNCName(local)) return undefined
		return nameOf({ uri: value.slice(1, closing), local })
	}
	const colon = value.indexOf(':')
	// `:x` names no prefix: no QName
	if (colon === 0) return undefined
	const prefix = colon === -1 ? '' : value.slice(0, colon)
	const local = colon === -1 ? value : value.slice(colon + 1)
	// an unprefixed QName with no default namespace in scope is in no namespace
	const uri = prefix ? namespaceOf(prefix) : (namespaceOf('') ?? '')
	if (uri === undefined || local === '') return undefined
	return nameOf({ uri, local })
}

function nameOf(params: { uri: string; local: string }): QualifiedName {
	const { uri, local } = params
	return { clark: uri ? `{${uri}}${local}` : local, namespace: uri, local }
}
