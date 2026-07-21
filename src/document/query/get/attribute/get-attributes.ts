import { getRecord } from '@/document'
import {
	getAttributeRules,
	resolvePrefixByNamespaceScope,
	resolveSchemaAttributeValue,
} from '@/utils'

import type { Context, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	AttributesValueObjectOf,
	ElementsOf,
	FullAttributeObjectOf,
} from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Fetch attributes for the given ref as a destructurable value object, scoped to a
 * single namespace and re-keyed by **local** name.
 *
 * Without `namespace`, only default-namespace (unprefixed) attributes are returned.
 * With a `namespace` key, only that namespace's attributes are returned, with the
 * prefix stripped from the keys (`ext:cA` → `cA`). `xmlns` declarations are
 * always excluded.
 *
 * `defaults` (default `'optional'`) controls how absent schema attributes are filled:
 * `'none'` = stored only; `'optional'` = read view (fixed / non-empty default);
 * `'required'` = XSD/export view (required as `''` + fixed). Stored values always win.
 *
 * @example
 * getAttributes({ context, ref })                       // → { aA: '', bA: '', ... }
 * getAttributes({ context, ref, namespace: 'ext' })     // → { cA: '...' }
 */

export async function getAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>> {
	const { context, ref, namespace, defaults = 'optional' } = params
	const { dialecteConfig } = context
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const targetPrefix =
		namespace === undefined ? '' : resolvePrefixByNamespaceScope(dialecteConfig, namespace)

	const stored = attributes.reduce(
		(acc, attr) => {
			const { prefix, local, isXmlns } = splitAttributeName(attr.name)
			if (isXmlns || prefix !== targetPrefix) return acc
			acc[local] = attr.value ?? ''
			return acc
		},
		{} as Record<string, string>,
	)

	// Fill absent schema attributes in the requested namespace scope per `defaults`.
	// Stored values already in `stored` are never overwritten.
	if (record && defaults !== 'none') {
		const sequence = dialecteConfig.definition[record.tagName]?.attributes.sequence ?? []
		for (const schemaName of sequence) {
			const { prefix, local, isXmlns } = splitAttributeName(schemaName)
			if (isXmlns || prefix !== targetPrefix || local in stored) continue
			const value = resolveSchemaAttributeValue({
				dialecteConfig,
				tagName: record.tagName,
				attributeName: schemaName,
				defaults,
			})
			if (value !== undefined) stored[local] = value
		}
	}

	return stored as AttributesValueObjectOf<GenericConfig, GenericElement>
}

/**
 * Fetch all attributes of a record as a full array (name + value + namespace).
 *
 * `defaults` (default `'optional'`) fills absent schema attributes just like
 * {@link getAttributes}: `'none'` returns the faithful stored-only set;
 * `'optional'`/`'required'` synthesize missing schema attributes (with their
 * schema-derived namespace).
 *
 * @example
 * getAttributes({ context, ref, fullObject: true })    // → FullAttributeObject[]
 */

export async function getAttributesFullObject<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	defaults?: AttributeDefaults
}): Promise<GenericAttribute[]> {
	const { context, ref, defaults = 'optional' } = params
	const { dialecteConfig } = context
	const record = await getRecord({ context, ref })
	const attributes = [...((record?.attributes ?? []) as GenericAttribute[])]

	if (record && defaults !== 'none') {
		const present = new Set(attributes.map((attribute) => attribute.name))
		const sequence = dialecteConfig.definition[record.tagName]?.attributes.sequence ?? []
		for (const schemaName of sequence) {
			if (present.has(schemaName)) continue
			const value = resolveSchemaAttributeValue({
				dialecteConfig,
				tagName: record.tagName,
				attributeName: schemaName,
				defaults,
			})
			if (value === undefined) continue
			const { namespace } = getAttributeRules({
				dialecteConfig,
				tagName: record.tagName,
				attributeName: schemaName,
			})
			attributes.push({ name: schemaName, value, namespace } as GenericAttribute)
		}
	}

	return attributes
}

/**
 * Split a stored attribute name into its XML prefix and local part. Default
 * (unprefixed) attributes report an empty prefix; `xmlns`/`xmlns:*` declarations
 * are flagged so callers can skip them.
 */
function splitAttributeName(name: string): { prefix: string; local: string; isXmlns: boolean } {
	if (name === 'xmlns' || name.startsWith('xmlns:')) {
		return { prefix: '', local: name, isXmlns: true }
	}
	const colonIndex = name.indexOf(':')
	if (colonIndex === -1) return { prefix: '', local: name, isXmlns: false }
	return { prefix: name.slice(0, colonIndex), local: name.slice(colonIndex + 1), isXmlns: false }
}
