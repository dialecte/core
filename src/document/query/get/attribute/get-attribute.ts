import { resolveRecord } from '@/document'
import { readAttribute } from '@/helpers'

import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf, FullAttributeObjectOf } from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Fetch a single attribute for the given ref or record.
 *
 * Resolves the record (a record given in full is read as it is, through the staged
 * operations; a ref via staged → cache → store, see `resolveRecord`), then reads the named
 * attribute with {@link readAttribute}. Pass `namespace` to scope by a namespace key (a local
 * `name` is resolved to the stored `prefix:local` key). `defaults` (default `'optional'`)
 * controls the fallback for an absent attribute: `'none'` → `''`; `'optional'` → `fixed` /
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
	ref: RefOrRecord<GenericConfig, GenericElement> | undefined
	name: string
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<GenericAttribute['value'] | ''> {
	const { context, ref, name, namespace, defaults } = params
	const record = await resolveRecord({ context, ref })
	if (!record) return ''
	const { dialecteConfig } = context
	return readAttribute({ record, dialecteConfig, name, namespace, defaults }) as
		| GenericAttribute['value']
		| ''
}

/**
 * Fetch a single attribute for the given ref or record as a full object (name + value +
 * namespace), read with {@link readAttribute}. `defaults` (default `'optional'`) fills an
 * absent schema attribute by synthesizing its object; `'none'` returns `undefined` when the
 * attribute is not stored.
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
	ref: RefOrRecord<GenericConfig, GenericElement> | undefined
	name: string
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<GenericAttribute | undefined> {
	const { context, ref, name, namespace, defaults } = params
	const record = await resolveRecord({ context, ref })
	if (!record) return undefined
	const { dialecteConfig } = context
	return readAttribute({ record, dialecteConfig, name, namespace, defaults, fullObject: true }) as
		| GenericAttribute
		| undefined
}
