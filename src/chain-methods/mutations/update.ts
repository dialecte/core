import { toFullAttributeArray, addStagedOperation, toChainRecord } from '@/helpers'

import type { ChainFactory } from '../types'
import type { AnyDialecteConfig, ElementsOf, Context, AttributesValueObjectOf } from '@/types'

/**
 * Updates the current focused element's attributes or value.
 *
 * @param chain - Chain factory to create new builder instances
 * @param contextPromise - Current chain context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to update element (sync chainable)
 */
export function createUpdateElementMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
}) {
	const { chain, contextPromise, dialecteConfig } = params

	return function (params: {
		attributes?: Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
		value?: string
	}) {
		const { attributes, value } = params

		const newContextPromise = contextPromise.then(async (context) => {
			const currentElement = context.currentFocus

			let updatedAttributes = currentElement.attributes
			if (attributes) {
				const newAttributes = toFullAttributeArray({
					tagName: currentElement.tagName,
					attributes,
					dialecteConfig,
				})

				const unchangedAttributes = currentElement.attributes.filter(
					(oldAttribute) =>
						!newAttributes.some((newAttribute) => newAttribute.name === oldAttribute.name),
				)

				updatedAttributes = [...unchangedAttributes, ...newAttributes]
			}

			const updatedElement = {
				...currentElement,
				attributes: updatedAttributes,
				value: value !== undefined ? value : currentElement.value,
			}

			addStagedOperation({
				context,
				status: 'updated',
				oldRecord: currentElement,
				newRecord: updatedElement,
			})

			return {
				...context,
				currentFocus: toChainRecord({ record: updatedElement, status: 'updated' }),
			}
		})

		return chain({ contextPromise: newContextPromise })
	}
}
