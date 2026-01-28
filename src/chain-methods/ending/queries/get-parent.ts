import { getRecord, assert } from '@/helpers'
import { DatabaseInstance } from '@/index'

import type { AnyDialecteConfig, ElementsOf, Context, ParentsOf, ChainRecord } from '@/types'

export function createGetParentMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { contextPromise, dialecteConfig, databaseInstance } = params
	return async function (): Promise<ChainRecord<GenericConfig, GenericParentElement>> {
		const context = await contextPromise
		assert(context.currentFocus.parent, 'Current element has no parent')

		const parentRecord = await getRecord<GenericConfig, GenericParentElement>({
			id: context.currentFocus.parent.id,
			tagName: context.currentFocus.parent.tagName as GenericParentElement,
			stagedOperations: context.stagedOperations,
			dialecteConfig,
			databaseInstance,
			type: 'chain',
		})

		assert(parentRecord, 'Parent record not found')

		return parentRecord
	}
}
