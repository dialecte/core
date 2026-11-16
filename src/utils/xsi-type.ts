import { trimXmlWhitespace } from './xml-whitespace'
import { ENGINE_XSD_PREFIX } from './xsi-type.constants'

import { throwDialecteError } from '@/errors'
import { XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'

import type {
	AttributeLike,
	NamespaceLookup,
	NamespacesConfig,
	XsiTypeName,
} from './xsi-type.types'
import type { Namespace } from '@/types'

export type { NamespaceLookup, XsiTypeName } from './xsi-type.types'

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
	// a QName collapses XML whitespace only: a no-break space is part of the name
	const value = trimXmlWhitespace({ text: params.value })
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
 * The type a record names with xsi:type, read in the form core stores it; `undefined` without xsi:type or when its
 * prefix is bound nowhere.
 *
 * @intent read the type an element names with xsi:type, resolve an xsi:type prefix to its namespace
 */
export function resolveXsiType(params: {
	dialecteConfig: NamespacesConfig
	record: { readonly attributes: readonly AttributeLike[] }
}): XsiTypeName | undefined {
	const { dialecteConfig, record } = params
	const attribute = record.attributes.find(isXsiTypeAttribute)
	if (attribute === undefined || typeof attribute.value !== 'string') return undefined
	const namespaceOf = storedNamespaceLookup({ dialecteConfig })
	return xsiTypeNameOf({ value: attribute.value, namespaceOf })
}

/**
 * The form core stores an xsi:type value in, one string whose prefixes come from the engine table only: the local
 * name for a type in the dialecte's default namespace, `prefix:local` for a namespace the dialecte declares,
 * `xs:local` for XSD (unless the dialecte declares the prefix `xs` itself), `{}local` for no namespace when the
 * default is not empty, and a Clark name `{uri}local` for any other namespace. A value whose prefix is bound
 * nowhere is kept as written. The value keeps what XML says it means: only the prefix it is written with changes.
 *
 * @intent write an xsi:type value the way core stores it, compare xsi:type values written with different prefixes
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
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	const declared = namespaces.find(
		(candidate) => candidate.uri === name.namespace && candidate.prefix !== '',
	)
	if (declared) return `${declared.prefix}:${name.local}`
	const xsTaken = namespaces.some((candidate) => candidate.prefix === ENGINE_XSD_PREFIX)
	if (name.namespace === XSD_NAMESPACE_URI && !xsTaken) return `${ENGINE_XSD_PREFIX}:${name.local}`
	if (name.namespace === '') return `{}${name.local}`
	return `{${name.namespace}}${name.local}`
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

/**
 * The lookup that reads a stored xsi:type value: the engine table only, no document declaration. `''` is the
 * dialecte's default namespace, a config prefix its namespace, `xs` XSD unless the config uses `xs` itself; any
 * other prefix is `undefined`.
 *
 * @intent read a stored xsi:type value, resolve a stored xsi:type prefix to its namespace
 */
export function storedNamespaceLookup(params: {
	dialecteConfig: NamespacesConfig
}): NamespaceLookup {
	const { dialecteConfig } = params
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	return function namespaceOf(prefix) {
		if (!prefix) return dialecteConfig.namespaces.default.uri
		const declared = namespaces.find((namespace) => namespace.prefix === prefix)
		if (declared) return declared.uri
		return prefix === ENGINE_XSD_PREFIX ? XSD_NAMESPACE_URI : undefined
	}
}

/**
 * Refuse an xsi:type value whose prefix the engine table does not bind (not `''`, not a config prefix, not `xs`): a
 * record carries no namespace declaration, so such a prefix names nothing. A Clark name is fine when it reads
 * `{uri}local`; a malformed one (no closing brace, no local name) is refused the same way.
 *
 * @internal write-path guard of create and update (never of a clone's copied values), run before the type is checked
 * for admission
 */
export function assertXsiTypePrefixKnown(params: {
	dialecteConfig: NamespacesConfig
	record: { readonly tagName: string; readonly attributes: readonly AttributeLike[] }
}): void {
	const { dialecteConfig, record } = params
	const namespaceOf = storedNamespaceLookup({ dialecteConfig })
	for (const attribute of record.attributes) {
		if (!isXsiTypeAttribute(attribute) || typeof attribute.value !== 'string') continue
		const value = trimXmlWhitespace({ text: attribute.value })
		if (value.startsWith('{')) {
			assertClarkNameReadable({ value, tagName: record.tagName })
			continue
		}
		const colon = value.indexOf(':')
		if (colon === -1) continue
		const prefix = value.slice(0, colon)
		if (namespaceOf(prefix) !== undefined) continue
		throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
			detail: `Unknown namespace prefix '${prefix}' in the xsi:type value '${value}' on '${record.tagName}' - use a prefix the dialecte declares, 'xs', or the Clark name '{uri}local'.`,
			ref: { tagName: record.tagName },
		})
	}
}

/** Refuse a Clark value core cannot read: `{uri}local` needs its closing brace and a local name. */
function assertClarkNameReadable(params: { value: string; tagName: string }): void {
	const { value, tagName } = params
	const closing = value.indexOf('}')
	if (closing !== -1 && closing < value.length - 1) return
	throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
		detail: `Malformed xsi:type value '${value}' on '${tagName}' - a Clark name is '{uri}local'.`,
		ref: { tagName },
	})
}
