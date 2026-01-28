import type { ChainTestOperation } from './test-operations.types'
import type { Chain, AnyChain } from '@/chain-methods'
import type { AnyGoToElementParams } from '@/chain-methods/navigation'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf } from '@/types'

/**
 * Execute a series of operations on a chain
 * Returns committed context
 */
export async function executeChainOperations<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	chain: Chain<GenericConfig, GenericElement>
	operations: Array<ChainTestOperation<GenericConfig, GenericElement, GenericChildElement>>
}) {
	const { chain, operations } = params

	let currentChain = chain as unknown as AnyChain

	for (const operation of operations) {
		switch (operation.type) {
			case 'update':
				currentChain = currentChain
					.goToElement(operation.goTo as AnyGoToElementParams)
					.update({ attributes: operation.attributes, value: operation.value })
				break
			case 'delete':
				currentChain = currentChain.goToElement(operation.goTo as AnyGoToElementParams).delete()
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
					})
				} else {
					currentChain = currentChain.addChild({
						id,
						tagName,
						attributes,
						namespace,
						value,
						setFocus: false,
					})
				}
				break
		}
	}

	const context = await currentChain.getContext()

	await currentChain.commit()

	return context
}
