import { stageOperation, stageOperations } from '../stage-operations'

import { getRecord } from '@/document'
import { standardizeRecord, toRef } from '@/helpers'
import { assert } from '@/utils'

import type { AddChildParams } from './create.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf, RawRecord, Ref } from '@/types'

/**
 * Fetches parent, builds and stages operations for adding a child.
 * Pushes operations directly to context.stagedOperations.
 */
export async function stageAddChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	dialecteConfig: GenericConfig
	context: Context<GenericConfig>
	parentRef: Ref<GenericConfig, GenericElement>
	params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>
}): Promise<RawRecord<GenericConfig, GenericChildElement>> {
	const { dialecteConfig, context, parentRef, params: childParams } = params
	const { id, tagName, attributes, namespace, value } = childParams

	const parentRecord = await getRecord({ context, ref: parentRef })
	assert(parentRecord, {
		detail: 'Parent record not found',
		key: 'ELEMENT_NOT_FOUND',
		ref: parentRef,
	})

	const childRecord = standardizeRecord({
		dialecteConfig,
		record: {
			id: id ?? crypto.randomUUID(),
			tagName,
			attributes,
			namespace,
			value,
			parent: { id: parentRecord.id, tagName: parentRecord.tagName },
			children: [],
		},
	})

	stageOperation({
		context,
		status: 'created',
		record: childRecord,
	})

	const updatedParent: RawRecord<GenericConfig, GenericElement> = {
		...parentRecord,
		children: [...parentRecord.children, { id: childRecord.id, tagName: childRecord.tagName }],
	}

	stageOperation({
		context,
		status: 'updated',
		oldRecord: parentRecord,
		newRecord: updatedParent,
	})

	if (dialecteConfig.hooks?.afterCreated) {
		const hookOperations = await dialecteConfig.hooks.afterCreated({
			childRecord,
			parentRecord: updatedParent,
			context,
		})
		stageOperations({ context, operations: hookOperations })
	}

	return childRecord
}
