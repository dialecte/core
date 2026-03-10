import { findByAttributes, matchesAttributeFilter, getRecord, getTree } from '@/document'
import { toRef } from '@/helpers'

import type { FilterCondition } from './find-descendant.types'
import type { Context, DescendantsFilter, FindDescendantsReturn } from '@/document'
import type {
	AnyDialecteConfig,
	ElementsOf,
	TrackedRecord,
	TreeRecord,
	Ref,
	AnyRef,
	ParentsOf,
} from '@/types'

/**
 * Find descendants matching filter with "any depth" semantic.
 *
 * Two modes:
 * 1. No filter → get all descendants from tree
 * 2. With filter → query deepest level, validate ancestors at any depth
 */
export async function findDescendants<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericFilter extends DescendantsFilter<GenericConfig> | undefined = undefined,
>(params: {
	context: Context<GenericConfig>
	dialecteConfig: GenericConfig
	ref: Ref<GenericConfig, GenericElement>
	filter?: GenericFilter
}): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericFilter>> {
	const { context, dialecteConfig, ref, filter } = params

	if (!filter) {
		return findAll({
			context,
			dialecteConfig,
			ref,
		}) as Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericFilter>>
	}

	return findFiltered({
		context,
		ref,
		filter,
	}) as Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericFilter>>
}

// ============================================================================
// No-filter path — flatten tree
// ============================================================================

async function findAll<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	dialecteConfig: GenericConfig
	ref: Ref<GenericConfig, GenericElement>
}) {
	const { context, dialecteConfig, ref } = params

	const tree = await getTree({ context, ref })
	if (!tree) return {}

	const descendants = flattenTree(tree)

	const allPossibleTypes = [ref.tagName as string, ...dialecteConfig.descendants[ref.tagName]]

	const result: Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}
	for (const tagName of allPossibleTypes) {
		result[tagName] = []
	}
	for (const record of descendants) {
		if (result[record.tagName]) {
			result[record.tagName].push(record)
		}
	}

	return result
}

// ============================================================================
// Filtered path — bottom-up ancestry validation
// ============================================================================

async function findFiltered<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	filter: DescendantsFilter<GenericConfig>
}) {
	const { context, ref, filter } = params

	const conditions = flattenFilterToConditions(filter)
	const collectTags = new Set(extractTags(filter))

	// Query deepest level
	const deepest = conditions[conditions.length - 1]
	const candidates = deepest.attributes
		? await findByAttributes({
				context,
				tagName: deepest.tagName as ElementsOf<GenericConfig>,
				attributes: deepest.attributes,
			})
		: await findByTagNameOnly({
				context,
				tagName: deepest.tagName as ElementsOf<GenericConfig>,
			})

	// Collect matching records grouped by tagName
	const collected = new Map<
		string,
		Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>
	>()

	for (const candidate of candidates) {
		const ancestry = await walkAncestryToRef({
			context,
			record: candidate,
			targetRef: ref,
		})

		if (ancestry.length === 0) continue

		if (!matchesAllConditions({ ancestry, conditions })) continue

		for (const ancestor of ancestry) {
			if (!collectTags.has(ancestor.tagName)) continue
			if (!collected.has(ancestor.tagName)) {
				collected.set(ancestor.tagName, new Map())
			}
			collected.get(ancestor.tagName)!.set(ancestor.id, ancestor)
		}
	}

	return groupAndDeduplicate({ collected, collectTags })
}

// ============================================================================
// Helpers
// ============================================================================

function flattenTree<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	tree: TreeRecord<GenericConfig, GenericElement>,
): TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] {
	const records: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	function traverse(node: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>) {
		if (!node.tree?.length) return
		for (const child of node.tree) {
			records.push(child)
			traverse(child)
		}
	}

	traverse(tree)
	return records
}

function flattenFilterToConditions<GenericConfig extends AnyDialecteConfig>(
	filter: DescendantsFilter<GenericConfig>,
): FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[] {
	const conditions: FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[] = [
		{
			tagName: filter.tagName,
			attributes: filter.attributes,
			optional: filter.isOptional === true,
		},
	]

	if (filter.descendant) {
		conditions.push(
			...flattenFilterToConditions(filter.descendant as DescendantsFilter<GenericConfig>),
		)
	}

	return conditions
}

function extractTags<GenericConfig extends AnyDialecteConfig>(
	filter: DescendantsFilter<GenericConfig>,
): ElementsOf<GenericConfig>[] {
	const tags: ElementsOf<GenericConfig>[] = [filter.tagName]

	if (filter.descendant) {
		tags.push(...extractTags(filter.descendant as DescendantsFilter<GenericConfig>))
	}

	return tags
}

async function walkAncestryToRef<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, GenericElement>
	targetRef: AnyRef
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, record, targetRef } = params

	const ancestry: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []
	let current: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined = record

	while (current && current.id !== targetRef.id) {
		ancestry.push(current)

		if (!current.parent) return [] // Reached root without finding target

		const parentRecord:
			| TrackedRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>
			| undefined = await getRecord({
			context,
			ref: toRef(current.parent),
		})

		if (!parentRecord) return [] // Parent not found

		current = parentRecord
	}

	if (!current || current.id !== targetRef.id) return []

	ancestry.push(current)
	return ancestry
}

function matchesAllConditions<GenericConfig extends AnyDialecteConfig>(params: {
	ancestry: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	conditions: FilterCondition<GenericConfig, ElementsOf<GenericConfig>>[]
}): boolean {
	const { ancestry, conditions } = params

	return conditions.every((condition) => {
		const found = ancestry.some((ancestor) => {
			if (ancestor.tagName !== condition.tagName) return false
			if (!condition.attributes) return true

			return matchesAttributeFilter({
				record: ancestor,
				attributeFilter: condition.attributes,
			})
		})

		return found || condition.optional === true
	})
}

function groupAndDeduplicate<GenericConfig extends AnyDialecteConfig>(params: {
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>
	collectTags: Set<string>
}): Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { collected, collectTags } = params

	const result: Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}
	for (const tag of collectTags) {
		result[tag] = []
	}
	for (const [tagName, recordMap] of collected.entries()) {
		if (collectTags.has(tagName)) {
			result[tagName] = Array.from(recordMap.values())
		}
	}

	return result
}

/**
 * Fallback when deepest condition has no attributes — get all by tagName.
 * Uses getRecordsByTagName via findByAttributes with empty filter.
 */
async function findByTagNameOnly<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	tagName: GenericElement
}): Promise<TrackedRecord<GenericConfig, GenericElement>[]> {
	const { context, tagName } = params
	return findByAttributes({
		context,
		tagName,
		attributes: {},
	})
}
