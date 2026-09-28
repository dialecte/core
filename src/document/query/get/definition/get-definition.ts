import { getRecord } from '@/document'
import { resolveDefinition } from '@/utils'

import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementDefinition, ElementsOf } from '@/types'

/**
 * The definition of an element in its context. The record is fetched (staged → cache → store),
 * so the parent is always known and a homonym reads as declared under it. `undefined` when the
 * ref points at no record, or at a tag the dialecte does not know.
 */
export async function getDefinition<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
}): Promise<ElementDefinition | undefined> {
	const { context, ref } = params
	const record = await getRecord({ context, ref })
	if (!record) return undefined
	return resolveDefinition({ dialecteConfig: context.dialecteConfig, record })
}
