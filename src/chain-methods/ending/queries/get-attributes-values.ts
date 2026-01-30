import { getAttributesValuesByName } from '@/utils'

import type { AnyDialecteConfig, ElementsOf, Context, FullAttributeObjectOf } from '@/types'

export function createGetAttributesValuesMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: { contextPromise: Promise<Context<GenericConfig, GenericElement>> }) {
	const { contextPromise } = params

	return async function <
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
	>(): Promise<Record<GenericAttribute['name'], GenericAttribute['value']>> {
		const context = await contextPromise

		return getAttributesValuesByName({ attributes: context.currentFocus.attributes })
	}
}
