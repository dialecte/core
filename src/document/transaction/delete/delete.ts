import { stageOperation, stageOperations } from '../stage-operations'

import { getRecord } from '@/document'
import { toRef } from '@/helpers'
import { assert } from '@/utils'

import type { Context } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ParentsOf,
	TrackedRecord,
	Ref,
	RawRecord,
} from '@/types'

/**
 * Stages deletion of a record and all its descendants.
 * Also removes the deleted record from its parent's children list.
 * Returns the parent ref for convenience
 */
export async function stageDelete<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): Promise<RawRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>> {
	const { dialecteConfig, context, ref } = params

	const record = await getRecord({ context, ref })
	assert(record, {
		detail: `Record not found (tagName=${ref.tagName}, id=${ref.id})`,
		key: 'ELEMENT_NOT_FOUND',
		ref,
	})

	assert(record.parent, {
		detail: 'Cannot delete root element',
		key: 'PROTECTED_ROOT',
	})

	// Fire before stageDescendants — root and descendants are still live in context here.
	// Hook receives the subtree root; SCL impl uses findDescendants to cover the full tree.
	if (dialecteConfig.hooks?.beforeDelete) {
		const hookOperations = await dialecteConfig.hooks.beforeDelete({ record, context })
		stageOperations({ context, operations: hookOperations })
	}

	// Stage descendants first (depth-first), then the record itself
	await stageDescendants({ context, record })

	stageOperation({ context, status: 'deleted', record })

	// Remove from parent's children and stage the update
	const parentRef = toRef(record.parent)

	const parentRecord = await getRecord({ context, ref: parentRef })
	assert(parentRecord, {
		detail: `Parent record not found (tagName=${record.parent.tagName}, id=${record.parent.id})`,
		key: 'ELEMENT_NOT_FOUND',
	})

	const updatedParent = {
		...parentRecord,
		children: parentRecord.children.filter((child) => child.id !== record.id),
	}

	stageOperation({ context, status: 'updated', oldRecord: parentRecord, newRecord: updatedParent })

	return updatedParent
}

async function stageDescendants<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, GenericElement>
}): Promise<void> {
	const { context, record } = params

	for (const childRef of record.children) {
		const ref = toRef(childRef)
		const childRecord = await getRecord({ context, ref })
		if (!childRecord) continue

		// Recurse depth-first before staging this child
		if (childRecord.children.length > 0) {
			await stageDescendants({ context, record: childRecord })
		}

		stageOperation({ context, status: 'deleted', record: childRecord })
	}
}
