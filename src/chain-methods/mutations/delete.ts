import { DatabaseInstance } from '@/database'
import { addStagedOperation, getRecord, toChainRecord } from '@/helpers'
import { assert } from '@/utils'

import type { ChainFactory } from '../types'
import type { DeleteElementParams } from './delete.types'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChainRecord,
	Context,
	ParentsOf,
	RawRecord,
	ChildrenOf,
	ExtensionRegistry,
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
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> =
		ExtensionRegistry<GenericConfig>,
>(params: {
	chain: ChainFactory<GenericConfig, GenericExtensionRegistry>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return function <GenericParentElement extends ParentsOf<GenericConfig, GenericElement>>(
		params: DeleteElementParams<GenericConfig, GenericElement, GenericParentElement>,
	) {
		const { parentTagName: newFocusedTagName } = params

		// Create new context promise with parent as focus
		const newContextPromise = contextPromise.then(async (context) => {
			const currentFocus = context.currentFocus

			assert(currentFocus.parent, 'Delete: Cannot delete root element')
			assert(
				currentFocus.parent.tagName === newFocusedTagName,
				'Delete: Focused element parent tag name mismatch',
			)

			addStagedOperation({
				context,
				status: 'deleted',
				record: currentFocus,
			})

			await removeAndStageChildren({
				context,
				dialecteConfig,
				databaseInstance,
				currentChild: currentFocus,
			})
			const updatedParent = await updateAndStageParent<
				GenericConfig,
				GenericElement,
				GenericParentElement
			>({
				context,
				dialecteConfig,
				databaseInstance,
			})

			return {
				...context,
				currentFocus: updatedParent,
			}
		})

		return chain<GenericParentElement>({
			contextPromise: newContextPromise,
			newFocusedTagName,
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
	GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}): Promise<ChainRecord<GenericConfig, GenericParentElement>> {
	const { context, dialecteConfig, databaseInstance } = params

	const parentRef = context.currentFocus.parent
	assert(parentRef, 'Cannot delete root element')

	const parentRecord = await getRecord<GenericConfig, GenericParentElement>({
		id: parentRef.id,
		tagName: parentRef.tagName as GenericParentElement,
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

	return toChainRecord<GenericConfig, GenericParentElement>({
		record: updatedParent,
		status: 'updated',
	})
}
