import { assert, toChainRecord, getLatestStagedRecord } from '@/helpers'

import { GoToElementParams } from './types'

import type { ChainFactory } from '../types'
import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ElementsOf, Context } from '@/types'

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
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return function goToElement<GenericTargetElement extends ElementsOf<GenericConfig>>(
		params: GoToElementParams<GenericConfig, GenericTargetElement>,
	) {
		const { tagName, id } = params
		const tableName = dialecteConfig.database.tables.xmlElements.name

		const newContextPromise = contextPromise.then(async (context) => {
			const isSingleton = dialecteConfig.singletonElements?.includes(tagName)

			const stagedRecord = id
				? getLatestStagedRecord<GenericConfig, GenericTargetElement>({
						stagedOperations: context.stagedOperations,
						id,
						tagName: tagName as GenericTargetElement,
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
				currentFocus: toChainRecord<GenericConfig, GenericTargetElement>({ record }),
			}
		})

		return chain({
			contextPromise: newContextPromise,
		})
	}
}
