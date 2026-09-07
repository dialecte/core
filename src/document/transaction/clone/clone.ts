import { stageAddChild } from '../create'

import { toRef } from '@/helpers'

import type { CloneResult, CloneMapping } from './clone.types'
import type { Context, Query, Ref } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	TreeRecord,
	RawRecord,
	TransactionHooks,
} from '@/types'

/**
 * Recursively stages a deep clone of a TreeRecord under a parent.
 * Returns a CloneResult with the new root ref and a full source→target mapping.
 *
 * Reference rewiring (e.g. repointing cloned refs onto the clone's identities) is
 * the dialecte's concern, done by the caller over the returned `mappings` — core
 * stays agnostic and structural.
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

	context.perf.start('core::deepClone')
	// Nested fine plan — no label: inherits the main's current step caption. The
	// count is a second full (in-memory) tree walk; sub-span it to confirm it stays
	// negligible vs the per-node staging below.
	context.perf.start('core::deepClone::countNodes')
	const totalNodes = countNodes(record)
	context.perf.stop('core::deepClone::countNodes')
	context.progress.plan({ steps: totalNodes })

	const clonedRecord = await cloneRecursively({
		dialecteConfig,
		hooks,
		context,
		query,
		parentRef,
		record,
		mappings,
	})

	context.progress.endPlan()
	context.perf.stop('core::deepClone')

	return {
		record: clonedRecord,
		mappings,
	}
}

/** Total nodes in a tree record (self + all descendants) — the deepClone step total. */
function countNodes(record: { tree: ReadonlyArray<{ tree: ReadonlyArray<unknown> }> }): number {
	let total = 1
	for (const child of record.tree) total += countNodes(child as typeof record)
	return total
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

	const source = toRef(record) as CloneMapping<GenericConfig>['source']
	mappings.push({
		source: Object.assign(source, {
			attributes: [...record.attributes],
		}),
		target: toRef(childRecord),
	})

	context.progress.nextStep()

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
