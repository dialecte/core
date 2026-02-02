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
	dialecteConfig: GenericConfig
}) {
	const { chain, contextPromise, dialecteConfig } = params

	return function <GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildParams<GenericConfig, GenericElement>,
	) {
		const { record, setFocus } = params

		const newContextPromise = contextPromise.then(async (context) => {
			const initialChain = chain<GenericConfig, GenericElement>({
				contextPromise: Promise.resolve(context),
			})

			let endingChain = await addChildRecursively({
				dialecteConfig,
				clonedRecordRootId: record.id,
				parentChain: initialChain,
				childRecord: record,
			})

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

async function addChildRecursively<GenericConfig extends AnyDialecteConfig>(params: {
	dialecteConfig: GenericConfig
	clonedRecordRootId: string
	parentChain: Chain<GenericConfig, ElementsOf<GenericConfig>>
	childRecord: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>
}): Promise<Chain<GenericConfig, ElementsOf<GenericConfig>>> {
	const { dialecteConfig, clonedRecordRootId, parentChain, childRecord } = params

	let shouldBeCloned = true
	let transformedChildRecord = childRecord
	let currentChain = parentChain

	if (dialecteConfig.hooks?.beforeClone) {
		const result = dialecteConfig.hooks.beforeClone({
			record: childRecord,
		})
		shouldBeCloned = result.shouldBeCloned
		transformedChildRecord = result.transformedRecord
	}

	if (shouldBeCloned) {
		const childChain = parentChain.addChild({
			tagName: transformedChildRecord.tagName,
			namespace: transformedChildRecord.namespace,
			attributes: transformedChildRecord.attributes,
			value: transformedChildRecord.value,
			setFocus: true,
		})

		currentChain = childChain

		for (const child of transformedChildRecord.tree) {
			currentChain = await addChildRecursively({
				dialecteConfig,
				clonedRecordRootId,
				parentChain: currentChain,
				childRecord: child,
			})
		}

		if (childRecord.id !== clonedRecordRootId) {
			currentChain = currentChain.goToParent()
		}
	}

	return currentChain
}
