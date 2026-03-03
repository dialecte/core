import { assert } from '@/helpers/assert'

import type { ChainTestOperation } from './test-operations.types'
import type { Chain, AnyChain } from '@/chain-methods'
import type { AnyGoToElementParams } from '@/chain-methods/navigation'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf, ExtensionRegistry } from '@/types'

/**
 * Execute a series of operations on a chain
 * Returns committed context
 *
 * Note: Operations can be from a compatible base config (e.g. without hooks)
 * and still work with a chain that has an extended config (e.g. with hooks).
 */
export async function executeTableDrivenTestsChainOperations<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig> = ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> = {},
	// GenericOperationsConfig extends AnyDialecteConfig = GenericConfig,
>(params: {
	chain: Chain<GenericConfig, GenericElement, GenericExtensionRegistry>
	operations: Array<
		ChainTestOperation<
			GenericConfig,
			ElementsOf<GenericConfig>,
			ChildrenOf<GenericConfig, ElementsOf<GenericConfig>>
		>
	>
}) {
	const { chain, operations } = params

	let currentChain = chain as unknown as AnyChain

	for (const operation of operations) {
		switch (operation.type) {
			case 'update':
				if (operation.goTo) {
					currentChain = currentChain.goToElement(operation.goTo as AnyGoToElementParams)
				}
				currentChain = currentChain.update({
					attributes: operation.attributes,
					value: operation.value,
				})
				break
			case 'delete':
				if (operation.goTo) {
					currentChain = currentChain.goToElement(operation.goTo as AnyGoToElementParams)
				}
				const { currentFocus } = await currentChain.getContext()
				assert(currentFocus.parent, 'ChainOperations: Current focus parent should be defined here')
				// @ts-ignore: delete method is not on root element, but we assert parent exists here
				currentChain = currentChain.delete({
					parentTagName: currentFocus.parent.tagName,
				})
				break
			case 'addChild':
				if (operation.goTo) {
					currentChain = currentChain.goToElement(operation.goTo as AnyGoToElementParams)
				}

				const { id, tagName, attributes, namespace, value, setFocus } = operation
				if (setFocus) {
					currentChain = currentChain.addChild({
						id,
						tagName,
						attributes,
						namespace,
						value,
						setFocus: true,
					}) as AnyChain
				} else {
					currentChain = currentChain.addChild({
						id,
						tagName,
						attributes,
						namespace,
						value,
						setFocus: false,
					}) as AnyChain
				}
				break
		}
	}

	const context = await currentChain.getContext()

	await currentChain.commit()

	return context
}
