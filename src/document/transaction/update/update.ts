import { stageOperation, stageOperations } from '../stage-operations'

import { getRecord } from '@/document'
import { toFullAttributeArray } from '@/helpers'
import { invariant } from '@/utils'

import type { UpdateParams } from './update.types'
import type { Context, Query } from '@/document'
import type { AnyDialecteConfig, ElementsOf, RawRecord, Ref, TransactionHooks } from '@/types'

/**
 * Merges attribute/value changes onto an existing record.
 * Undefined/null attribute values are stripped (treated as removals).
 * Returns the same ref — the element does not move.
 */
export async function stageUpdate<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	context: Context<GenericConfig>
	query: Query<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	params: UpdateParams<GenericConfig, GenericElement>
}): Promise<RawRecord<GenericConfig, GenericElement>> {
	const { dialecteConfig, hooks, context, query, ref, params: updateParams } = params
	const { attributes, value } = updateParams

	const record = await getRecord({ context, ref })
	invariant(record, {
		detail: `Record not found (tagName=${ref.tagName}, id=${ref.id})`,
		key: 'ELEMENT_NOT_FOUND',
		ref,
	})

	let updatedAttributes = record.attributes
	if (attributes) {
		const newAttributes = toFullAttributeArray({
			dialecteConfig,
			tagName: record.tagName,
			attributes,
		})

		const unchangedAttributes = record.attributes.filter(
			(old) => !newAttributes.some((next) => next.name === old.name),
		)

		updatedAttributes = [...unchangedAttributes, ...newAttributes].filter(
			(attr) => attr.value !== undefined && attr.value !== null,
		)
	}

	const updatedRecord = {
		...record,
		attributes: updatedAttributes,
		value: value !== undefined ? value : record.value,
	}

	stageOperation({ context, status: 'updated', oldRecord: record, newRecord: updatedRecord })

	if (hooks?.afterUpdated) {
		const hookOperations = await hooks.afterUpdated({
			oldRecord: record,
			newRecord: updatedRecord,
			query,
		})
		stageOperations({ context, operations: hookOperations })
	}

	return updatedRecord
}
