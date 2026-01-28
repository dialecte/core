import { assert, toChainRecord, getLatestStagedRecord } from '@/helpers'

import type { ChainFactory } from '../types'
import type { DatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ElementsOf, Context, RawRecord, ParentsOf } from '@/types'

/**
 * Navigate to the parent element.
 * Type narrows to the target element.
 *
 * @param contextPromise - Current builder context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to navigate to the parent (sync chainable, type narrows)
 */
export function createGoToParentMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return function goToParent<
		GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
	>() {
		const newContextPromise = contextPromise.then(async (context) => {
			const parentRef = context.currentFocus.parent
			assert(parentRef, 'Current focus parent should be defined here')

			const stagedParentRecord = getLatestStagedRecord<GenericConfig, GenericParentElement>({
				stagedOperations: context.stagedOperations,
				id: parentRef.id,
				tagName: parentRef.tagName as GenericParentElement,
			})

			let parentRecord: RawRecord<GenericConfig, GenericParentElement>

			if (stagedParentRecord) {
				parentRecord = stagedParentRecord.record
			} else {
				const elementsTableName = dialecteConfig.database.tables.xmlElements.name
				const record = await databaseInstance.table(elementsTableName).get({
					id: parentRef.id,
					tagName: parentRef.tagName,
				})
				assert(record, 'Parent record should be found in database')
				parentRecord = record
			}

			return {
				...context,
				currentFocus: toChainRecord({ record: parentRecord }),
			}
		})

		return chain({ contextPromise: newContextPromise })
	}
}
