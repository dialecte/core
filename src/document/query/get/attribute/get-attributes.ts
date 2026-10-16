import { resolveRecord } from '@/document'
import { readAttributes } from '@/helpers'

import type { Context, RefOrRecord } from '@/document'
import type {
	AnyDialecteConfig,
	AttributesValueObjectOf,
	ElementsOf,
	FullAttributeObjectOf,
} from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Fetch attributes for the given ref or record as a destructurable value object. A record given in full is read as it
 * is, through the staged operations, with no store round trip (see `resolveRecord`); the reading itself is
 * {@link readAttributes}.
 *
 * Without `namespace`, every attribute under the name it is stored by (`aA`, `xsi:type`, `ext:cA`) - what a write takes
 * back. With a `namespace` key, only that namespace's attributes, with the prefix stripped from the keys
 * (`ext:cA` → `cA`). Namespace declarations are always excluded.
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
	_GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement> | undefined
	namespace?: string
	defaults?: AttributeDefaults
}): Promise<AttributesValueObjectOf<GenericConfig, GenericElement>> {
	const { context, ref, namespace, defaults } = params
	const record = await resolveRecord({ context, ref })
	if (!record) return {} as AttributesValueObjectOf<GenericConfig, GenericElement>
	const { dialecteConfig } = context
	return readAttributes({ record, dialecteConfig, namespace, defaults }) as AttributesValueObjectOf<
		GenericConfig,
		GenericElement
	>
}

/**
 * Fetch all attributes of the given ref or record as a full array (name + value + namespace), read with
 * {@link readAttributes}.
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
	ref: RefOrRecord<GenericConfig, GenericElement> | undefined
	defaults?: AttributeDefaults
}): Promise<GenericAttribute[]> {
	const { context, ref, defaults } = params
	const record = await resolveRecord({ context, ref })
	if (!record) return []
	const { dialecteConfig } = context
	return readAttributes({
		record,
		dialecteConfig,
		defaults,
		fullObject: true,
	}) as GenericAttribute[]
}
