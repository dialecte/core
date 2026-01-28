import { DeepCloneChildParams } from './clone.types'

import type { Chain, ChainFactory } from '../types'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf, Context, TreeRecord } from '@/types'

/**
 * Deep clones the child element under the current focused element.
 *
 * @param chain - Chain factory to create new builder instances
 * @param contextPromise - Current chain context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to create element (sync chainable)
 */
export function createDeepCloneChildMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
}) {
	const { chain, contextPromise } = params

	return function <GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildParams<GenericConfig, GenericElement>,
	) {
		const { record, setFocus } = params

		const newContextPromise = contextPromise.then(async (context) => {
			const initialChain = chain<GenericConfig, GenericElement>({
				contextPromise: Promise.resolve(context),
			})

			let endingChain = await addChildRecursively({
				chain: initialChain,
				childRecord: record,
			})

			async function addChildRecursively(params: {
				chain: Chain<GenericConfig, ElementsOf<GenericConfig>>
				childRecord: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>
			}): Promise<Chain<GenericConfig, ElementsOf<GenericConfig>>> {
				const { chain, childRecord } = params

				const childChain = chain.addChild({
					tagName: childRecord.tagName,
					namespace: childRecord.namespace,
					attributes: childRecord.attributes,
					value: childRecord.value,
					setFocus: true,
				})

				let currentChain = childChain

				for (const child of childRecord.tree) {
					currentChain = await addChildRecursively({ chain: currentChain, childRecord: child })
					currentChain = currentChain.goToParent()
				}

				return currentChain
			}

			if (!setFocus) endingChain = endingChain.goToParent()

			return await endingChain.getContext()
		})

		if (setFocus) {
			return chain<GenericConfig, GenericChildElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericChildElement>>,
			})
		} else {
			return chain<GenericConfig, GenericElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericElement>>,
			})
		}
	}
}
