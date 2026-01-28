import { getRecord, matchesAttributeFilter, toTreeRecord } from '@/helpers'

import type { GetTreeParams, IncludeFilter, ExcludeFilter } from './get-tree.types'
import type { DatabaseInstance } from '@/index'
import type { AnyDialecteConfig, ElementsOf, Context, ChainRecord, TreeRecord } from '@/types'

export function createGetTreeMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}) {
	const { contextPromise, dialecteConfig, databaseInstance } = params

	return async function (
		params: GetTreeParams<GenericConfig, GenericElement> = {},
	): Promise<TreeRecord<GenericConfig, GenericElement>> {
		const { include, exclude, unwrap } = params
		const context = await contextPromise

		const tree = await buildTreeWithFilters({
			root: context.currentFocus,
			context,
			dialecteConfig,
			databaseInstance,
			include,
			exclude,
		})

		if (!tree) {
			return toTreeRecord({ record: context.currentFocus })
		}

		return unwrap ? applyUnwrap({ tree, unwrapTagNames: unwrap }) : tree
	}
}

/**
 * Build tree with include/exclude filters applied during traversal
 */
async function buildTreeWithFilters<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	root: ChainRecord<GenericConfig, GenericElement>
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	include?: IncludeFilter<GenericConfig, GenericElement>
	exclude?: ExcludeFilter<GenericConfig>[]
}): Promise<TreeRecord<GenericConfig, GenericElement> | null> {
	const { root, context, dialecteConfig, databaseInstance, include, exclude } = params

	async function buildNode(params: {
		record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
		includeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
	}): Promise<TreeRecord<GenericConfig, ElementsOf<GenericConfig>> | null> {
		const { record, includeFilter } = params

		// Check if we should stop traversing children
		if (shouldStopTraversal({ record, excludeFilters: exclude })) {
			return toTreeRecord({ record })
		}

		// Fetch and filter children
		const childrenToProcess = await fetchAndFilterChildren({
			record,
			context,
			dialecteConfig,
			databaseInstance,
			currentIncludeFilter: includeFilter,
			excludeFilters: exclude,
		})

		// Build child trees in parallel
		const childTrees = await Promise.all(
			childrenToProcess.map(({ record: child, includeFilter: childInclude }) =>
				buildNode({ record: child, includeFilter: childInclude }),
			),
		)

		// Filter out null results (pruned by include)
		const validChildren = childTrees.filter(
			(tree): tree is TreeRecord<GenericConfig, ElementsOf<GenericConfig>> => tree !== null,
		)

		return toTreeRecord({ record, tree: validChildren })
	}

	return buildNode({ record: root, includeFilter: include }) as Promise<TreeRecord<
		GenericConfig,
		GenericElement
	> | null>
}

/**
 * Check if node should be included based on include filter
 */
// function shouldIncludeNode<GenericConfig extends AnyDialecteConfig>(params: {
// 	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
// 	includeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
// }): boolean {
// 	const { record, includeFilter } = params
// 	if (!includeFilter) return true

// 	return matchesFilter({ record, filter: includeFilter })
// }

/**
 * Check if we should stop traversing children (exclude with scope: 'children')
 */
function shouldStopTraversal<GenericConfig extends AnyDialecteConfig>(params: {
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	excludeFilters?: ExcludeFilter<GenericConfig>[]
}): boolean {
	const { record, excludeFilters } = params
	if (!excludeFilters) return false

	return excludeFilters.some((filter) => {
		const scope = filter.scope ?? 'self'
		if (scope !== 'children') return false

		return matchesFilter({ record, filter })
	})
}

/**
 * Check if child should be excluded (exclude with scope: 'self')
 */
function shouldExcludeChild<GenericConfig extends AnyDialecteConfig>(params: {
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	excludeFilters?: ExcludeFilter<GenericConfig>[]
}): boolean {
	const { record, excludeFilters } = params
	if (!excludeFilters) return false

	return excludeFilters.some((filter) => {
		const scope = filter.scope ?? 'self'
		if (scope !== 'self') return false

		return matchesFilter({ record, filter })
	})
}

/**
 * Fetch children in parallel and apply filters
 */
async function fetchAndFilterChildren<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	currentIncludeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
	excludeFilters?: ExcludeFilter<GenericConfig>[]
}): Promise<
	Array<{
		record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
		includeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
	}>
> {
	const {
		record,
		context,
		dialecteConfig,
		databaseInstance,
		currentIncludeFilter,
		excludeFilters,
	} = params

	// Fetch all children in parallel
	const children = await fetchChildren({
		record,
		context,
		dialecteConfig,
		databaseInstance,
	})

	// Filter out excluded children
	const nonExcludedChildren = children.filter(
		(child) => !shouldExcludeChild({ record: child, excludeFilters }),
	)

	// Match children with include filter branches
	return matchChildrenWithIncludeFilters({ children: nonExcludedChildren, currentIncludeFilter })
}

/**
 * Fetch all children in parallel
 */
async function fetchChildren<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
}): Promise<ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { record, context, dialecteConfig, databaseInstance } = params

	if (!record.children?.length) return []

	const childRecords = await Promise.all(
		record.children.map((childRef) =>
			getRecord({
				id: childRef.id,
				tagName: childRef.tagName,
				stagedOperations: context.stagedOperations,
				dialecteConfig,
				databaseInstance,
				type: 'chain',
			}),
		),
	)

	return childRecords.filter(
		(child): child is ChainRecord<GenericConfig, ElementsOf<GenericConfig>> => !!child,
	)
}

/**
 * Match children with include filter branches and determine which to traverse
 * The currentIncludeFilter describes what children at THIS level should match.
 * If they match, they get the descendants filter for their own children.
 */
function matchChildrenWithIncludeFilters<GenericConfig extends AnyDialecteConfig>(params: {
	children: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	currentIncludeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
}): Array<{
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	includeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
}> {
	const { children, currentIncludeFilter } = params

	// If no include filter, process all children with no filter
	if (!currentIncludeFilter) {
		return children.map((child) => ({ record: child, includeFilter: undefined }))
	}

	// First, filter children based on current filter
	const matchingChildren = children.filter((child) =>
		matchesFilter({ record: child, filter: currentIncludeFilter }),
	)

	// If currentIncludeFilter has descendants, match each child to the appropriate descendant branch
	if (currentIncludeFilter.children && currentIncludeFilter.children.length > 0) {
		const matched: Array<{
			record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
			includeFilter?: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>
		}> = []

		for (const child of matchingChildren) {
			// Find which descendant branch matches this child
			const matchingBranch = findMatchingIncludeBranch({
				child,
				branches: currentIncludeFilter.children,
			})

			// If a branch matches, use it for filtering the child's children
			// If no branch matches, child is included but its children aren't filtered
			matched.push({ record: child, includeFilter: matchingBranch })
		}

		return matched
	}

	// No descendants - children match current filter and get no further filtering
	return matchingChildren.map((child) => ({ record: child, includeFilter: undefined }))
}

/**
 * Find the first include filter branch that matches the child
 */
function findMatchingIncludeBranch<GenericConfig extends AnyDialecteConfig>(params: {
	child: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	branches: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[]
}): IncludeFilter<GenericConfig, ElementsOf<GenericConfig>> | undefined {
	const { child, branches } = params
	return branches.find((branch) => matchesFilter({ record: child, filter: branch }))
}

/**
 * Check if record matches filter (tagName + attributes)
 */
function matchesFilter<GenericConfig extends AnyDialecteConfig>(params: {
	record: ChainRecord<GenericConfig, ElementsOf<GenericConfig>>
	filter: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>> | ExcludeFilter<GenericConfig>
}): boolean {
	const { record, filter } = params

	if (record.tagName !== filter.tagName) {
		return false
	}

	if (filter.attributes) {
		return matchesAttributeFilter(record, filter.attributes)
	}

	return true
}

/**
 * Apply unwrap filter - remove specified elements but promote their children
 */
function applyUnwrap<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tree: TreeRecord<GenericConfig, GenericElement>
	unwrapTagNames: ElementsOf<GenericConfig>[]
}): TreeRecord<GenericConfig, GenericElement> {
	const { tree, unwrapTagNames } = params

	function processChildren(
		children: TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[],
	): TreeRecord<GenericConfig, ElementsOf<GenericConfig>>[] {
		return children.flatMap((child) => {
			// If child should be unwrapped, promote its children
			if (unwrapTagNames.includes(child.tagName)) {
				return processChildren(child.tree)
			}

			// Keep child, process its children recursively
			return [
				{
					...child,
					tree: processChildren(child.tree),
				},
			]
		})
	}

	return {
		...tree,
		tree: processChildren(tree.tree),
	}
}
