import { createGetTreeMethod } from '../get-tree'
import { flattenFilterToConditions, extractTags } from './filter-utils.helper'
import { flattenTree } from './flatten-tree.helper'
import { groupAndDeduplicate } from './group-records.helper'
import { matchesAllConditions } from './match-conditions.helper'
import { walkAncestryToFocus } from './walk-ancestry.helper'

import { DatabaseInstance } from '@/database'
import { findByAttributes } from '@/helpers'

import type { FindDescendantsReturn, DescendantsFilter } from './types'
import type { AnyDialecteConfig, Context, ElementsOf, ChainRecord, DescendantsOf } from '@/types'

/**
 * Find descendants matching filter with "any depth" semantic
 *
 * Two modes:
 * 1. No filter → get all descendants from tree
 * 2. With filter → query deepest level, validate ancestors at any depth
 */
export function createFindDescendantsMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { contextPromise, dialecteConfig, databaseInstance } = params

	async function findDescendants<
		GenericFilter extends DescendantsFilter<GenericConfig> | undefined,
	>(filter?: GenericFilter): FindDescendantsReturn<GenericConfig, GenericFilter, GenericElement> {
		const context = await contextPromise

		if (!filter) {
			return findAll({
				contextPromise,
				dialecteConfig,
				databaseInstance,
				currentElement: context.currentFocus.tagName,
			}) as FindDescendantsReturn<GenericConfig, GenericFilter, GenericElement>
		}

		return findFiltered({
			context,
			dialecteConfig,
			databaseInstance,
			filter,
		}) as FindDescendantsReturn<GenericConfig, GenericFilter>
	}

	return findDescendants
}

/**
 * Find all descendants without filter (uses tree)
 * Returns all possible descendant types (including current element) with empty arrays if not present
 */
async function findAll<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	currentElement: GenericElement
}) {
	const { contextPromise, dialecteConfig, databaseInstance, currentElement } = params

	const getTree = createGetTreeMethod({ contextPromise, dialecteConfig, databaseInstance })
	const tree = await getTree()
	const descendants = flattenTree(tree)

	// Get all possible descendant types from config (including current element)
	const allPossibleTypes = [currentElement, ...dialecteConfig.descendants[currentElement]]

	// Initialize result with empty arrays for all types
	const result: Record<
		string,
		ChainRecord<GenericConfig, DescendantsOf<GenericConfig, GenericElement>>[]
	> = {}
	for (const tagName of allPossibleTypes) {
		result[tagName] = []
	}

	// Populate with actual records
	for (const record of descendants) {
		if (result[record.tagName]) {
			result[record.tagName].push(record)
		}
	}

	return result
}

/**
 * Find filtered descendants with "any depth" validation
 *
 * Algorithm:
 * 1. Flatten filter to conditions (e.g., [FunctionCategory, FunctionCatRef])
 * 2. Query deepest level (FunctionCatRef with attributes)
 * 3. For each result, walk up ancestry to focus
 * 4. Check if ALL conditions exist somewhere in ancestry (any depth, any order)
 * 5. Collect all ancestors matching filter tags
 * 6. Deduplicate and group by tagName
 */
async function findFiltered<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	filter: DescendantsFilter<GenericConfig>
}) {
	const { context, dialecteConfig, databaseInstance, filter } = params

	// Extract conditions and tags
	const conditions = flattenFilterToConditions(filter)
	const collectTags = new Set(extractTags(filter))

	// Query deepest level
	const deepest = conditions[conditions.length - 1]
	const candidates = await findByAttributes({
		context,
		dialecteConfig,
		databaseInstance,
		tagName: deepest.tagName as ElementsOf<GenericConfig>,
		attributes: deepest.attributes,
	})

	// Collect matching records grouped by tagName
	const collected = new Map<
		string,
		Map<string, ChainRecord<GenericConfig, ElementsOf<GenericConfig>>>
	>()

	for (const candidate of candidates) {
		// Walk up to focus
		const ancestry = await walkAncestryToFocus({
			record: candidate,
			focus: context.currentFocus,
			dialecteConfig,
			databaseInstance,
			stagedOperations: context.stagedOperations,
		})

		// If not descendant of focus, skip
		if (ancestry.length === 0) {
			continue
		}

		// Check if all conditions exist in ancestry (any depth)
		const matches = matchesAllConditions({
			ancestry,
			conditions,
		})

		if (!matches) {
			continue
		}

		// Collect all ancestors that match filter tags
		for (const ancestor of ancestry) {
			if (collectTags.has(ancestor.tagName)) {
				if (!collected.has(ancestor.tagName)) {
					collected.set(ancestor.tagName, new Map())
				}
				// Map deduplicates by id
				collected.get(ancestor.tagName)!.set(ancestor.id, ancestor)
			}
		}
	}

	// Convert to result format
	return groupAndDeduplicate({ collected, collectTags })
}
