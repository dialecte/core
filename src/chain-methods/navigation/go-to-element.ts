import { GoToElementParams } from './types'

import { assert, toChainRecord, getLatestStagedRecord } from '@/helpers'

import type { ChainFactory } from '../types'
import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ElementsOf, Context, ExtensionRegistry } from '@/types'

/**
 * Navigate to a specific element by tagName and id.
 * Type narrows to the target element.
 *
 * @param contextPromise - Current builder context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to navigate to element (sync chainable, type narrows)
 */
export function createGoToElementMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> =
		ExtensionRegistry<GenericConfig>,
>(params: {
	chain: ChainFactory<GenericConfig, GenericExtensionRegistry>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return function goToElement<GenericFocusElement extends ElementsOf<GenericConfig>>(
		params: GoToElementParams<GenericConfig, GenericFocusElement>,
	) {
		const { tagName, id } = params

		const tableName = dialecteConfig.database.tables.xmlElements.name

		const newContextPromise = contextPromise.then(async (context) => {
			const isSingleton = dialecteConfig.singletonElements?.includes(tagName)

			const stagedRecord = id
				? getLatestStagedRecord<GenericConfig, GenericFocusElement>({
						stagedOperations: context.stagedOperations,
						id,
						tagName: tagName as GenericFocusElement,
					})
				: null

			let record = stagedRecord?.status !== 'deleted' ? stagedRecord?.record : undefined

			if (!record) {
				const db = databaseInstance.table(tableName)

				if (!id && !isSingleton) {
					throw new Error(`Element ${tagName} requires an id parameter`)
				}

				record = await (isSingleton && !id
					? db.where('tagName').equals(tagName).first()
					: db.get({ id, tagName }))
			}

			assert(
				record,
				id
					? `Element "${tagName}" with id "${id}" not found in database`
					: `Element "${tagName}" not found in database`,
			)

			assert(
				record.tagName === tagName,
				`Element tagName mismatch: expected "${tagName}", got "${record.tagName}"`,
			)

			return {
				...context,
				currentFocus: toChainRecord<GenericConfig, GenericFocusElement>({ record }),
			}
		})

		return chain<GenericFocusElement>({
			contextPromise: newContextPromise,
			newFocusedTagName: tagName as GenericFocusElement,
		})
	}
}
