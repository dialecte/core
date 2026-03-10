import { stageOperation } from '../stage-operations'

import { getRecord } from '@/document'
import { toFullAttributeArray } from '@/helpers'
import { assert } from '@/utils'

import type { UpdateParams } from './update.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, Ref } from '@/types'

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
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	params: UpdateParams<GenericConfig, GenericElement>
}): Promise<Ref<GenericConfig, GenericElement>> {
	const { dialecteConfig, context, ref, params: updateParams } = params
	const { attributes, value } = updateParams

	const record = await getRecord({ context, ref })
	assert(record, {
		detail: `Record not found (tagName=${ref.tagName}, id=${ref.id})`,
		method: 'update',
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

	return ref
}
