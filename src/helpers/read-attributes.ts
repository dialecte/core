import { XMLNS_NAMESPACE_URI } from './constant'

import {
	getAttributeRules,
	resolveDefinition,
	resolvePrefixByNamespaceScope,
	resolveSchemaAttributeValue,
} from '@/utils'

import type { ReadAttributesBaseParams } from './read-attributes.types'
import type { AnyAttribute, AnyDialecteConfig, AnyRawRecord, Namespace } from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Read one attribute of a record you hold, the way `query.getAttribute` reads it - same `namespace` scope, same
 * `defaults` fill, same `''` for an absent attribute - with no query: synchronous, for an import pass or a pure
 * composer. `query.getAttribute` itself delegates to it once it has the record.
 *
 * `fullObject: true` returns the attribute object, or `undefined` when there is none in that view: with
 * `defaults: 'none'`, how to tell an absent attribute from one written empty.
 *
 * Reads the record as you hold it. Inside a transaction use `tx.getAttribute`, which sees the transaction's staged
 * writes: a record held from before a write still reads its old values here.
 *
 * @example
 * readAttribute({ record, dialecteConfig, name: 'aA' })                                      // → 'v' | ''
 * readAttribute({ record, dialecteConfig, name: 'aA', defaults: 'none', fullObject: true }) // → undefined when absent
 *
 * @see {@link readAttributes}
 */
export function readAttribute(
	params: ReadAttributesBaseParams & { name: string; namespace?: string; fullObject?: false },
): string
export function readAttribute(
	params: ReadAttributesBaseParams & { name: string; namespace?: string; fullObject: true },
): AnyAttribute | undefined
export function readAttribute(
	params: ReadAttributesBaseParams & { name: string; namespace?: string; fullObject?: boolean },
): AnyAttribute | string | undefined {
	const { record, dialecteConfig, name, namespace, fullObject, defaults = 'optional' } = params
	const storedName = resolveStoredAttributeName({ dialecteConfig, name, namespace })
	const stored = record.attributes.find((attribute) => attribute.name === storedName)
	if (stored) return fullObject ? stored : stored.value

	// Not stored: the schema value for the requested `defaults` view.
	const value = resolveSchemaAttributeValue({
		dialecteConfig,
		record,
		attributeName: storedName,
		defaults,
	})
	if (!fullObject) return value ?? ''
	if (value === undefined) return undefined
	const { namespace: attributeNamespace } = getAttributeRules({
		dialecteConfig,
		record,
		attributeName: storedName,
	})
	return { name: storedName, value, namespace: attributeNamespace }
}

/**
 * The name an attribute is stored by: without a namespace scope the name as given (a bare local name, or an
 * already-canonical `prefix:local` key); with a scope the local `name` prefixed with the scope's XML prefix.
 */
function resolveStoredAttributeName(params: {
	dialecteConfig: AnyDialecteConfig
	name: string
	namespace: string | undefined
}): string {
	const { dialecteConfig, name, namespace } = params
	if (namespace === undefined) return name
	const prefix = resolvePrefixByNamespaceScope(dialecteConfig, namespace)
	return prefix ? `${prefix}:${name}` : name
}

/**
 * Read the attributes of a record you hold, the way `query.getAttributes` reads them - each under the name it is
 * stored by, or keyed by local name in a `namespace` scope, absent schema attributes filled per `defaults` - with no
 * query: synchronous, for an import pass or a pure composer. `query.getAttributes`
 * itself delegates to it once it has the record. Values are plain strings: for typed reads use the query.
 *
 * Namespace declarations are left out of the value object; `fullObject: true` returns the stored attributes as they
 * are, a declaration a document carries included (stored by its prefix, in the xmlns namespace).
 *
 * Reads the record as you hold it. Inside a transaction use `tx.getAttributes`, which sees the transaction's staged
 * writes: a record held from before a write still reads its old values here.
 *
 * @example
 * readAttributes({ record, dialecteConfig })                        // → { aA: 'v', 'ext:cA': 'w' }
 * readAttributes({ record, dialecteConfig, defaults: 'none' })      // → stored only
 * readAttributes({ record, dialecteConfig, fullObject: true })      // → AnyAttribute[]
 *
 * @see {@link readAttribute}
 */
export function readAttributes(
	params: ReadAttributesBaseParams & { namespace?: string; fullObject?: false },
): Record<string, string>
export function readAttributes(
	params: ReadAttributesBaseParams & { fullObject: true },
): AnyAttribute[]
export function readAttributes(
	params: ReadAttributesBaseParams & { namespace?: string; fullObject?: boolean },
): Record<string, string> | AnyAttribute[] {
	return params.fullObject ? readAttributeObjects(params) : readAttributeValues(params)
}

/**
 * The value object: stored values keyed by `keyOf`, then the absent schema attributes of the scope filled per
 * `defaults`. A stored value is never overwritten.
 */
function readAttributeValues(params: {
	record: AnyRawRecord
	dialecteConfig: AnyDialecteConfig
	namespace?: string
	defaults?: AttributeDefaults
}): Record<string, string> {
	const { record, dialecteConfig, namespace, defaults = 'optional' } = params
	const targetPrefix =
		namespace === undefined ? undefined : resolvePrefixByNamespaceScope(dialecteConfig, namespace)

	const values: Record<string, string> = {}
	for (const attribute of record.attributes) {
		const key = keyOf({ name: attribute.name, namespace: attribute.namespace, targetPrefix })
		if (key !== undefined) values[key] = attribute.value ?? ''
	}
	if (defaults === 'none') return values

	for (const schemaName of schemaAttributeNames({ dialecteConfig, record })) {
		const key = keyOf({ name: schemaName, targetPrefix })
		if (key === undefined || key in values) continue
		const value = resolveSchemaAttributeValue({
			dialecteConfig,
			record,
			attributeName: schemaName,
			defaults,
		})
		if (value !== undefined) values[key] = value
	}
	return values
}

/** The full objects: the stored ones as they are, then the absent schema attributes synthesized per `defaults`. */
function readAttributeObjects(params: {
	record: AnyRawRecord
	dialecteConfig: AnyDialecteConfig
	defaults?: AttributeDefaults
}): AnyAttribute[] {
	const { record, dialecteConfig, defaults = 'optional' } = params
	const attributes = [...record.attributes]
	if (defaults === 'none') return attributes

	const present = new Set(attributes.map((attribute) => attribute.name))
	for (const schemaName of schemaAttributeNames({ dialecteConfig, record })) {
		if (present.has(schemaName)) continue
		const value = resolveSchemaAttributeValue({
			dialecteConfig,
			record,
			attributeName: schemaName,
			defaults,
		})
		if (value === undefined) continue
		const { namespace } = getAttributeRules({ dialecteConfig, record, attributeName: schemaName })
		attributes.push({ name: schemaName, value, namespace })
	}
	return attributes
}

/** The attributes the record's definition declares, in schema order; none for an element the config does not know. */
function schemaAttributeNames(params: {
	dialecteConfig: AnyDialecteConfig
	record: AnyRawRecord
}): readonly string[] {
	const { dialecteConfig, record } = params
	return resolveDefinition({ dialecteConfig, record })?.attributes.sequence ?? []
}

/**
 * The key an attribute has in a value object: without a scope (`targetPrefix` undefined) the name it is stored by
 * (`aA`, `xsi:type`, `ext:cA`); in a namespace scope its local name, when it is in that namespace. A namespace
 * declaration has none - as parsed it is stored by its prefix alone, in the xmlns namespace.
 */
function keyOf(params: {
	name: string
	namespace?: Namespace
	targetPrefix: string | undefined
}): string | undefined {
	const { name, namespace, targetPrefix } = params
	const { prefix, local, isXmlns } = splitAttributeName(name)
	if (isXmlns || namespace?.uri === XMLNS_NAMESPACE_URI) return undefined
	if (targetPrefix === undefined) return name
	return prefix === targetPrefix ? local : undefined
}

/**
 * Split a stored attribute name into its XML prefix and local part. Default (unprefixed) attributes report an empty
 * prefix; `xmlns`/`xmlns:*` declarations are flagged so callers can skip them.
 */
function splitAttributeName(name: string): { prefix: string; local: string; isXmlns: boolean } {
	if (name === 'xmlns' || name.startsWith('xmlns:')) {
		return { prefix: '', local: name, isXmlns: true }
	}
	const colonIndex = name.indexOf(':')
	if (colonIndex === -1) return { prefix: '', local: name, isXmlns: false }
	return { prefix: name.slice(0, colonIndex), local: name.slice(colonIndex + 1), isXmlns: false }
}
