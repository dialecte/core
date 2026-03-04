import { DeepCloneChildParams } from './clone.types'

import { assert } from '@/utils'

import type { Chain, ChainFactory } from '../types'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Context,
	TreeRecord,
	ExtensionRegistry,
} from '@/types'

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
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> =
		ExtensionRegistry<GenericConfig>,
>(params: {
	chain: ChainFactory<GenericConfig, GenericExtensionRegistry>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	focusedTagName: GenericElement
}) {
	const { chain, contextPromise, dialecteConfig, focusedTagName: parentTagName } = params

	return function <GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildParams<GenericConfig, GenericChildElement>,
	) {
		const { record, setFocus } = params

		const newContextPromise = contextPromise.then(async (context) => {
			const initialChain = chain<GenericElement>({
				contextPromise: Promise.resolve(context),
			})

			let endingChain = await addChildRecursively({
				dialecteConfig,
				clonedRecordRootId: record.id,
				parentChain: initialChain,
				childRecord: record,
			})

			let endingContext = await endingChain.getContext()

			if (!setFocus && endingContext.currentFocus.parent)
				endingContext = await endingChain
					.goToParent(endingContext.currentFocus.parent.tagName)
					.getContext()

			return endingContext
		})

		if (setFocus) {
			return chain<GenericChildElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericChildElement>>,
				newFocusedTagName: record.tagName,
			})
		} else {
			return chain<GenericElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericElement>>,
				newFocusedTagName: parentTagName,
			})
		}
	}
}

async function addChildRecursively<
	GenericConfig extends AnyDialecteConfig,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> =
		ExtensionRegistry<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	clonedRecordRootId: string
	parentChain: Chain<GenericConfig, ElementsOf<GenericConfig>, GenericExtensionRegistry>
	childRecord: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>
}): Promise<Chain<GenericConfig, ElementsOf<GenericConfig>, GenericExtensionRegistry>> {
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
			const { currentFocus } = await currentChain.getContext()
			assert(currentFocus.parent, 'Clone: Current focus parent should be defined here')
			currentChain = currentChain.goToParent(currentFocus.parent.tagName)
		}
	}

	return currentChain
}
