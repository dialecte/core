import { getRecord } from '@/document'
import { resolvePrefixByNamespaceScope } from '@/utils'

import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, FullAttributeObjectOf } from '@/types'

/**
 * Fetch a single attribute for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then extracts the named attribute. Pass `namespace` to scope by a namespace key
 * (a local `name` is resolved to the stored `prefix:local` key).
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
}): Promise<GenericAttribute['value'] | ''> {
	const { context, ref, name, namespace } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const storedName = resolveStoredAttributeName(context.dialecteConfig, name, namespace)
	const attribute = attributes.find((attribute) => attribute.name === storedName)

	return attribute?.value ?? ''
}

/**
 * Fetch a single attribute for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then extracts the named attribute.
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
}): Promise<GenericAttribute | undefined> {
	const { context, ref, name, namespace } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const storedName = resolveStoredAttributeName(context.dialecteConfig, name, namespace)
	const attribute = attributes.find((attribute) => attribute.name === storedName)
	return attribute
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
