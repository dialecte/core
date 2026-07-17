import { getRecord } from '@/document'
import { resolvePrefixByNamespaceScope } from '@/utils'

import type { Context, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	AttributesValueObjectOf,
	ElementsOf,
	FullAttributeObjectOf,
} from '@/types'

/**
 * Fetch attributes for the given ref as a destructurable value object, scoped to a
 * single namespace and re-keyed by **local** name.
 *
 * Without `namespace`, only default-namespace (unprefixed) attributes are returned.
 * With a `namespace` key, only that namespace's attributes are returned, with the
 * prefix stripped from the keys (`ext:cA` → `cA`). `xmlns` declarations are
 * always excluded. Use `getAttributesFullObject` for the complete, prefixed set.
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
}): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>> {
	const { context, ref, namespace } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

	const targetPrefix =
		namespace === undefined ? '' : resolvePrefixByNamespaceScope(context.dialecteConfig, namespace)

	return attributes.reduce(
		(acc, attr) => {
			const { prefix, local, isXmlns } = splitAttributeName(attr.name)
			if (isXmlns || prefix !== targetPrefix) return acc
			acc[local] = attr.value ?? ''
			return acc
		},
		{} as Record<string, string>,
	) as AttributesValueObjectOf<GenericConfig, GenericElement>
}

/**
 * Fetch all attributes for the given ref.
 *
 * Resolves the record via context (staged → cache → store),
 * then returns attributes as a full array.
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
}): Promise<GenericAttribute[]> {
	const { context, ref } = params
	const record = await getRecord({ context, ref })
	const attributes = (record?.attributes ?? []) as GenericAttribute[]

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
