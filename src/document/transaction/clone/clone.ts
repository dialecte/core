import { stageAddChild } from '../create'

import { toRef } from '@/helpers'

import type { CloneResult, CloneMapping } from './clone.types'
import type { Context, Query } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	TreeRecord,
	Ref,
	RawRecord,
	TransactionHooks,
} from '@/types'

/**
 * Recursively stages a deep clone of a TreeRecord under a parent.
 * Returns a CloneResult with the new root ref and a full source→target mapping.
 *
 */
export async function stageDeepClone<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	context: Context<GenericConfig>
	query: Query<GenericConfig>
	parentRef: Ref<GenericConfig, GenericElement>
	record: TreeRecord<GenericConfig, GenericChildElement>
}): Promise<CloneResult<GenericConfig, GenericChildElement>> {
	const { dialecteConfig, hooks, context, query, parentRef, record } = params

	const mappings: CloneMapping<GenericConfig>[] = []

	const clonedRecord = await cloneRecursively({
		dialecteConfig,
		hooks,
		context,
		query,
		parentRef,
		record,
		mappings,
	})

	if (hooks?.afterDeepClone) {
		const additionalOperations = await hooks.afterDeepClone({
			mappings,
			query,
		})
		context.stagedOperations.push(...additionalOperations)
	}

	return {
		record: clonedRecord,
		mappings,
	}
}

async function cloneRecursively<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
	context: Context<GenericConfig>
	query: Query<GenericConfig>
	parentRef: Ref<GenericConfig, ElementsOf<GenericConfig>>
	record: TreeRecord<GenericConfig, GenericElement>
	mappings: CloneMapping<GenericConfig>[]
}): Promise<RawRecord<GenericConfig, GenericElement>> {
	const { dialecteConfig, hooks, context, query, parentRef, record, mappings } = params

	let shouldBeCloned = true
	let transformedRecord = record

	if (hooks?.beforeClone) {
		const result = hooks.beforeClone({ record })
		shouldBeCloned = result.shouldBeCloned
		transformedRecord = result.transformedRecord
	}

	if (!shouldBeCloned) return transformedRecord

	const childRecord = await stageAddChild({
		dialecteConfig,
		hooks,
		context,
		query,
		parentRef,
		params: {
			tagName: transformedRecord.tagName,
			namespace: transformedRecord.namespace,
			attributes: transformedRecord.attributes,
			value: transformedRecord.value,
		},
	})

	mappings.push({
		source: toRef(record),
		target: toRef(childRecord),
	})

	for (const child of transformedRecord.tree) {
		await cloneRecursively({
			dialecteConfig,
			hooks,
			context,
			query,
			parentRef: toRef(childRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			record: child,
			mappings,
		})
	}

	return childRecord
}
