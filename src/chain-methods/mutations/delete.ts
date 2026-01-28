import { addStagedOperation, assert, getRecord, toChainRecord } from '@/helpers'
import { DatabaseInstance } from '@/index'

import type { ChainFactory } from '../types'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChainRecord,
	Context,
	ParentsOf,
	RawRecord,
	ChildrenOf,
} from '@/types'

/**
 * Deletes the current focused element.
 * Returns builder focused on parent element.
 *
 * @param chain - Chain factory to create new builder instances
 * @param contextPromise - Current chain context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to delete element (sync chainable, narrows to parent)
 */
export function createDeleteElementMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return function () {
		// Create new context promise with parent as focus
		const newContextPromise = contextPromise.then(async (context) => {
			const currentElement = context.currentFocus

			addStagedOperation({
				context,
				status: 'deleted',
				record: currentElement,
			})

			await removeAndStageChildren({
				context,
				dialecteConfig,
				databaseInstance,
				currentChild: currentElement,
			})
			const updatedParent = await updateAndStageParent({
				context,
				dialecteConfig,
				databaseInstance,
			})

			return {
				...context,
				currentFocus: updatedParent,
			}
		})

		return chain({
			contextPromise: newContextPromise,
		})
	}
}

async function removeAndStageChildren<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	currentChild: RawRecord<GenericConfig, GenericChildElement>
}) {
	const { context, dialecteConfig, databaseInstance, currentChild } = params

	for (const childRef of currentChild.children) {
		const childRecord = await getRecord({
			id: childRef.id,
			tagName: childRef.tagName,
			stagedOperations: context.stagedOperations,
			dialecteConfig,
			databaseInstance,
		})
		if (!childRecord) continue

		if (childRecord.children?.length > 0) {
			await removeAndStageChildren({
				context,
				dialecteConfig,
				databaseInstance,
				currentChild: childRecord,
			})
		}

		addStagedOperation({
			context,
			status: 'deleted',
			record: childRecord,
		})
	}
}

async function updateAndStageParent<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}): Promise<ChainRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>> {
	const { context, dialecteConfig, databaseInstance } = params

	const parentRef = context.currentFocus.parent
	assert(parentRef, 'Cannot delete root element')

	const parentRecord = await getRecord({
		id: parentRef.id,
		tagName: parentRef.tagName,
		stagedOperations: context.stagedOperations,
		dialecteConfig,
		databaseInstance,
	})

	assert(parentRecord, 'Parent record not found')

	const updatedParent = {
		...parentRecord,
		children: parentRecord.children.filter((child) => child.id !== context.currentFocus.id),
	}

	addStagedOperation({
		context,
		status: 'updated',
		oldRecord: parentRecord,
		newRecord: updatedParent,
	})

	return toChainRecord({ record: updatedParent, status: 'updated' })
}
