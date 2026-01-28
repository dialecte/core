import { findByAttributes } from '@/helpers'

import type { FindChildrenParams } from './find-children.types'
import type { FilterAttributes } from '@/helpers'
import type { DatabaseInstance } from '@/index'
import type { AnyDialecteConfig, ElementsOf, Context, ChildrenOf, ChainRecord } from '@/types'

export function createFindChildrenMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { contextPromise, dialecteConfig, databaseInstance } = params

	return async function <GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		filters: FindChildrenParams<GenericConfig, GenericElement, GenericChild>,
	): Promise<Record<GenericChild, ChainRecord<GenericConfig, GenericChild>[]>> {
		const context = await contextPromise
		const results: Record<string, ChainRecord<GenericConfig, GenericChild>[]> = {}

		for (const [tagName, attributes] of Object.entries(filters)) {
			const candidates = await findByAttributes<GenericConfig, GenericChild>({
				context,
				dialecteConfig,
				databaseInstance,
				tagName: tagName as GenericChild,
				attributes: attributes as FilterAttributes<GenericConfig, GenericChild>,
			})

			// Filter to only children of current focus
			const children = candidates.filter((candidate) => {
				return (
					candidate.parent?.tagName === context.currentFocus.tagName &&
					candidate.parent?.id === context.currentFocus.id
				)
			})

			if (!results[tagName]) {
				results[tagName] = []
			}
			results[tagName].push(...children)
		}

		return results as Record<GenericChild, ChainRecord<GenericConfig, GenericChild>[]>
	}
}
