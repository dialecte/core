import {
	canonicalQualifiedName,
	assertQualifiedNameReadable,
	storedNamespaceLookup,
} from './qname-value'
import { qualifiedNameOf } from './qualified-name'

import { XSI_NAMESPACE } from '@/helpers/constant'

import type { NamespaceLookup, NamespacesConfig } from './qname-value.types'
import type { AttributeLike, XsiTypeName } from './xsi-type.types'

export type { NamespaceLookup, XsiTypeName } from './xsi-type.types'

/** Whether an attribute is xsi:type: `type` in the XSI namespace, whatever prefix the document gave it. */
export function isXsiTypeAttribute(attribute: AttributeLike): boolean {
	return (
		attribute.namespace?.uri === XSI_NAMESPACE.uri && attribute.name.split(':').at(-1) === 'type'
	)
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
	return qualifiedNameOf({ value: attribute.value, namespaceOf })
}

/**
 * The form core stores an xsi:type value in: the local name for a type in the dialecte's default namespace,
 * `prefix:local` for a namespace the dialecte declares, `xml:local` for the XML namespace, `xs:local` for XSD (unless
 * the dialecte declares the prefix `xs` itself), `{}local` for no namespace when the default is not empty, and a Clark name
 * `{uri}local` for any other namespace. A value whose prefix is bound nowhere is kept as written.
 *
 * @intent write an xsi:type value the way core stores it, compare xsi:type values written with different prefixes
 */
export function canonicalXsiType(params: {
	dialecteConfig: NamespacesConfig
	value: string
	namespaceOf: NamespaceLookup
}): string {
	return canonicalQualifiedName(params)
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
	for (const attribute of record.attributes) {
		if (!isXsiTypeAttribute(attribute) || typeof attribute.value !== 'string') continue
		assertQualifiedNameReadable({
			dialecteConfig,
			value: attribute.value,
			what: 'xsi:type value',
			tagName: record.tagName,
		})
	}
}
