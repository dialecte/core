import { createGetTreeMethod } from '../get-tree'
import { filterToPath, extractTags } from './filter-utils.helper'
import { flattenTree } from './flatten-tree.helper'
import { validateDescendants } from './validate-descendants.helper'

import { DatabaseInstance } from '@/database'
import { findByAttributes } from '@/helpers'

import type { FindDescendantsReturn, DescendantsFilter } from './types'
import type { AnyDialecteConfig, Context, ElementsOf, ChainRecord, DescendantsOf } from '@/types'

/**
 * Find descendants matching filter with path validation
 *
 * Two modes:
 * 1. No filter → get all descendants from tree
 * 2. With filter → query deepest level, validate path bottom-up
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
 * Find filtered descendants with path validation
 */
async function findFiltered<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	filter: DescendantsFilter<GenericConfig>
}) {
	const { context, dialecteConfig, databaseInstance, filter } = params

	// Collect all tags from filter
	const collectTags = new Set(extractTags(filter))

	// Flatten filter to path
	const path = filterToPath(filter)
	const deepest = path[path.length - 1]
	const ancestors = path.slice(0, -1)

	// Query deepest level
	const candidates = await findByAttributes({
		context,
		dialecteConfig,
		databaseInstance,
		tagName: deepest.tagName as ElementsOf<GenericConfig>,
		attributes: deepest.attributes,
	})

	// Validate and collect - returns grouped, deduplicated result
	return await validateDescendants({
		context,
		dialecteConfig,
		databaseInstance,
		candidates,
		focus: context.currentFocus,
		path: ancestors.length > 0 ? ancestors : undefined,
		collectTags,
	})
}
