import { mayHoldQualifiedNames } from './qname-typed'
import { assertQNameValueReadable, canonicalQNameValue } from './qname-value'
import { resolveDefinition } from './resolve-definition'

import type { NamespaceLookup } from './qname-value.types'
import type { ResolvableRecord } from './resolve-definition.types'
import type { AttributeLike } from './xsi-type.types'
import type { AnyDialecteConfig, AnyRawRecord, DataType, ResolvedDefinition } from '@/types'

/**
 * The definition that applies to a record, when the record is that declaration's element: in the declaration's
 * namespace. An element of the tag in another namespace (a foreign homonym, `ext:EE_1` where only the default
 * declares `EE_1`) is none of its declarations: its values are not typed by them.
 *
 * @internal the one rule import, writes, export and filters read QName-typed values by
 */
export function declaredDefinitionOf(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'types' | 'namespaces'>
	record: ResolvableRecord
}): ResolvedDefinition | undefined {
	const { dialecteConfig, record } = params
	const definition = resolveDefinition({ dialecteConfig, record })
	if (definition === undefined || definition.namespace.uri !== record.namespace?.uri)
		return undefined
	return definition
}

/**
 * The datatype the definition gives an attribute of the record, when it declares that attribute: the same name and
 * the same namespace (a bare name is in no namespace). A foreign attribute whose prefix collides with a dialecte
 * prefix (`ext:cEE_1` with `ext` bound elsewhere) has none.
 *
 * @internal which attribute values are QName-typed
 */
export function declaredAttributeTypeOf(params: {
	definition: ResolvedDefinition
	attribute: AttributeLike
}): DataType | undefined {
	const { definition, attribute } = params
	const detail = definition.attributes.details[attribute.name]
	if (detail === undefined) return undefined
	if (detail.namespace?.uri !== attribute.namespace?.uri) return undefined
	return detail.type
}

/**
 * The record's QName-typed attribute values and text in the form core stores them (`canonicalQNameValue`), read with
 * `namespaceOf` (made only when needed). The record itself when its tag holds no QName-typed value anywhere, or when
 * it is not the element of the definition that applies (`declaredDefinitionOf`); a new record otherwise.
 *
 * @internal the QName step of record standardization (import, create, update, the hook re-run)
 */
export function withCanonicalQNameValues<GenericRecord extends AnyRawRecord>(params: {
	dialecteConfig: AnyDialecteConfig
	record: GenericRecord
	namespaceOf: () => NamespaceLookup
	/** The values are a file's, read with its bindings: a qualified name is lexical only, a Clark name is no QName. */
	lexicalOnly: boolean
}): GenericRecord {
	const { dialecteConfig, record, lexicalOnly } = params
	if (!mayHoldQualifiedNames({ dialecteConfig, tagName: record.tagName })) return record
	const definition = declaredDefinitionOf({ dialecteConfig, record })
	if (definition === undefined) return record
	const namespaceOf = params.namespaceOf()
	const textType = definition.textContent?.type
	const value =
		textType !== undefined && record.value !== ''
			? canonicalQNameValue({
					dialecteConfig,
					type: textType,
					value: record.value,
					namespaceOf,
					lexicalOnly,
				})
			: record.value
	const attributes = record.attributes.map((attribute) => {
		const type = declaredAttributeTypeOf({ definition, attribute })
		if (type === undefined || typeof attribute.value !== 'string') return attribute
		const canonical = canonicalQNameValue({
			dialecteConfig,
			type,
			value: attribute.value,
			namespaceOf,
			lexicalOnly,
		})
		return canonical === attribute.value ? attribute : { ...attribute, value: canonical }
	})
	return { ...record, attributes, value }
}

/**
 * Refuse a QName-typed value a write authors that core cannot read from the engine table (`assertQualifiedNameReadable`
 * on each name, each list item). `authored` names what the write gave: the attributes, and whether the text; without
 * it every value of the record is checked. A copied value is never judged here: a clone keeps what it copies.
 *
 * @internal write-path guard of create and update
 */
export function assertQNameValuesReadable(params: {
	dialecteConfig: AnyDialecteConfig
	record: AnyRawRecord
	authored?: { readonly attributes: ReadonlySet<string>; readonly text: boolean }
}): void {
	const { dialecteConfig, record, authored } = params
	if (!mayHoldQualifiedNames({ dialecteConfig, tagName: record.tagName })) return
	const definition = declaredDefinitionOf({ dialecteConfig, record })
	if (definition === undefined) return
	const textType = definition.textContent?.type
	if (textType !== undefined && (authored?.text ?? true)) {
		assertQNameValueReadable({
			dialecteConfig,
			type: textType,
			value: record.value,
			what: 'text',
			tagName: record.tagName,
		})
	}
	for (const attribute of record.attributes) {
		if (authored !== undefined && !authored.attributes.has(attribute.name)) continue
		const type = declaredAttributeTypeOf({ definition, attribute })
		if (type === undefined || typeof attribute.value !== 'string') continue
		assertQNameValueReadable({
			dialecteConfig,
			type,
			value: attribute.value,
			what: `value of '${attribute.name}'`,
			tagName: record.tagName,
		})
	}
}
