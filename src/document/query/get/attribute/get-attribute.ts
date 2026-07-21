import { getRecord } from '@/document'
import {
	getAttributeRules,
	resolvePrefixByNamespaceScope,
	resolveSchemaAttributeValue,
} from '@/utils'

import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, FullAttributeObjectOf } from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Fetch a single attribute for the given ref.
 *
 * Resolves the record via context (staged → cache → store), then extracts the named
 * attribute. Pass `namespace` to scope by a namespace key (a local `name` is resolved
 * to the stored `prefix:local` key). `defaults` (default `'optional'`) controls the
 * fallback for an absent attribute: `'none'` → `''`; `'optional'` → `fixed` /
 * non-empty `default` (else `''`); `'required'` → required/fixed materialized value.
 *
 * @example
 * getAttribute({ context, ref, name: 'aA' })                    // → string | ''
 * getAttribute({ context, ref, name: 'cA', namespace: 'ext' })  // → ext:cA value
 */
export async function getAttribute<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	name: string
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<GenericAttribute['value'] | ''> {
	const { context, ref, name, namespace, defaults = 'optional' } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const storedName = resolveStoredAttributeName(context.dialecteConfig, name, namespace)
	const attribute = attributes.find((attribute) => attribute.name === storedName)
	if (attribute) return attribute.value

	// Not stored: fall back to the schema value for the requested `defaults` view.
	const value = record
		? resolveSchemaAttributeValue({
				dialecteConfig: context.dialecteConfig,
				tagName: record.tagName,
				attributeName: storedName,
				defaults,
			})
		: undefined
	return (value ?? '') as GenericAttribute['value'] | ''
}

/**
 * Fetch a single attribute for the given ref as a full object (name + value +
 * namespace). `defaults` (default `'optional'`) fills an absent schema attribute by
 * synthesizing its object; `'none'` returns `undefined` when the attribute is not
 * stored.
 *
 * @example
 * getAttribute({ context, ref, name: 'name', fullObject: true }) // → FullAttributeObject | undefined
 */
export async function getAttributeFullObject<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	name: string
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<GenericAttribute | undefined> {
	const { context, ref, name, namespace, defaults = 'optional' } = params
	const { dialecteConfig } = context
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const storedName = resolveStoredAttributeName(dialecteConfig, name, namespace)
	const attribute = attributes.find((attribute) => attribute.name === storedName)
	if (attribute) return attribute

	// Not stored: synthesize from the schema for the requested `defaults` view.
	if (!record || defaults === 'none') return undefined
	const value = resolveSchemaAttributeValue({
		dialecteConfig,
		tagName: record.tagName,
		attributeName: storedName,
		defaults,
	})
	if (value === undefined) return undefined
	const { namespace: attributeNamespace } = getAttributeRules({
		dialecteConfig,
		tagName: record.tagName,
		attributeName: storedName,
	})
	return { name: storedName, value, namespace: attributeNamespace } as GenericAttribute
}

/**
 * Resolve the stored attribute name for a lookup: without a namespace scope the
 * name is used verbatim (a bare local name, or an already-canonical `prefix:local`
 * key); with a scope the local `name` is prefixed with the scope's XML prefix.
 */
function resolveStoredAttributeName(
	dialecteConfig: AnyDialecteConfig,
	name: string,
	namespaceScope: string | undefined,
): string {
	if (namespaceScope === undefined) return name
	const prefix = resolvePrefixByNamespaceScope(dialecteConfig, namespaceScope)
	return prefix ? `${prefix}:${name}` : name
}
