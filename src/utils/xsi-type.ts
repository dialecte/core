import { XMLNS_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'

import type { NamespaceLookup, XsiTypeName } from './xsi-type.types'
import type { AnyDialecteConfig, Namespace } from '@/types'

export type { NamespaceLookup, XsiTypeName } from './xsi-type.types'

type NamespacesConfig = Pick<AnyDialecteConfig, 'namespaces'>
type AttributeLike = {
	readonly name: string
	readonly value: unknown
	readonly namespace?: Namespace
}

/** Whether an attribute is xsi:type: `type` in the XSI namespace, whatever prefix the document gave it. */
export function isXsiTypeAttribute(attribute: AttributeLike): boolean {
	return (
		attribute.namespace?.uri === XSI_NAMESPACE.uri && attribute.name.split(':').at(-1) === 'type'
	)
}

/**
 * The type a QName value names, read with `namespaceOf`: `prefix:local`, `local` (the default namespace, none when
 * no default is bound) or a Clark name `{uri}local`. `undefined` when its prefix is bound nowhere.
 */
export function xsiTypeNameOf(params: {
	value: string
	namespaceOf: NamespaceLookup
}): XsiTypeName | undefined {
	const { namespaceOf } = params
	const value = params.value.trim()
	if (value.startsWith('{')) {
		const closing = value.indexOf('}')
		if (closing === -1) return undefined
		return typeName({ uri: value.slice(1, closing), local: value.slice(closing + 1) })
	}
	const colon = value.indexOf(':')
	const prefix = colon === -1 ? '' : value.slice(0, colon)
	const local = colon === -1 ? value : value.slice(colon + 1)
	// an unprefixed QName with no default namespace in scope is in no namespace
	const uri = prefix ? namespaceOf(prefix) : (namespaceOf('') ?? '')
	if (uri === undefined) return undefined
	return typeName({ uri, local })
}

/**
 * The type a record names with xsi:type, read as core stores it (`storedNamespaceLookup`); `undefined` without
 * xsi:type or when its prefix is bound nowhere.
 */
export function resolveXsiType(params: {
	dialecteConfig: NamespacesConfig
	record: { readonly attributes: readonly AttributeLike[] }
}): XsiTypeName | undefined {
	const { dialecteConfig, record } = params
	const attribute = record.attributes.find(isXsiTypeAttribute)
	if (attribute === undefined || typeof attribute.value !== 'string') return undefined
	const namespaceOf = storedNamespaceLookup({ dialecteConfig, attributes: record.attributes })
	return xsiTypeNameOf({ value: attribute.value, namespaceOf })
}

/**
 * How core reads a stored xsi:type value: unprefixed is the dialecte's default namespace, a dialecte prefix its
 * namespace (the canonical form); another prefix is read where the record itself binds it (a value kept as written).
 */
export function storedNamespaceLookup(params: {
	dialecteConfig: NamespacesConfig
	attributes: readonly AttributeLike[]
}): NamespaceLookup {
	const { dialecteConfig, attributes } = params
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	return function namespaceOf(prefix) {
		if (!prefix) return dialecteConfig.namespaces.default.uri
		const declared = namespaces.find((namespace) => namespace.prefix === prefix)
		if (declared) return declared.uri
		// as parsed (`q` in the xmlns namespace) or as created (`xmlns:q`)
		const binding = attributes.find(
			(attribute) =>
				attribute.name === `xmlns:${prefix}` ||
				(attribute.namespace?.uri === XMLNS_NAMESPACE_URI && attribute.name === prefix),
		)
		return typeof binding?.value === 'string' ? binding.value : undefined
	}
}

/**
 * The form core stores an xsi:type value in: the local name for a type in the dialecte's default namespace, the
 * dialecte's prefix and the local name for a type in another namespace it declares. A value whose prefix is bound
 * nowhere, or naming a namespace the dialecte does not declare, is kept as written. The value keeps what XML says it
 * means: only the prefix it is written with changes.
 */
export function canonicalXsiType(params: {
	dialecteConfig: NamespacesConfig
	value: string
	namespaceOf: NamespaceLookup
}): string {
	const { dialecteConfig, value, namespaceOf } = params
	const name = xsiTypeNameOf({ value, namespaceOf })
	if (name === undefined) return value
	if (name.namespace === dialecteConfig.namespaces.default.uri) return name.local
	const namespace = (Object.values(dialecteConfig.namespaces) as Namespace[]).find(
		(candidate) => candidate.uri === name.namespace && candidate.prefix !== '',
	)
	return namespace ? `${namespace.prefix}:${name.local}` : value
}

/** The attributes with the xsi:type value, if any, in the form core stores (`canonicalXsiType`). */
export function withCanonicalXsiType<GenericAttribute extends AttributeLike>(params: {
	dialecteConfig: NamespacesConfig
	attributes: readonly GenericAttribute[]
	namespaceOf: NamespaceLookup
}): GenericAttribute[] {
	const { dialecteConfig, attributes, namespaceOf } = params
	return attributes.map((attribute) =>
		isXsiTypeAttribute(attribute) && typeof attribute.value === 'string'
			? {
					...attribute,
					value: canonicalXsiType({ dialecteConfig, value: attribute.value, namespaceOf }),
				}
			: attribute,
	)
}

function typeName(params: { uri: string; local: string }): XsiTypeName {
	const { uri, local } = params
	return { clark: uri ? `{${uri}}${local}` : local, namespace: uri, local }
}
