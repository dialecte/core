import { matchesAttributeFilter, getRecord } from '@/document'
import { toRef, toTreeRecord } from '@/helpers'
import { assert } from '@/utils'

import type { GetTreeParams, IncludeFilter, ExcludeFilter } from './get-tree.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, TreeRecord, Ref } from '@/types'

export async function getTree<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options?: GetTreeParams<GenericConfig, GenericElement>
}): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
	const { context, ref, options = {} } = params
	const { include, exclude, unwrap } = options

	const root = await getRecord({ context, ref })
	assert(root, {
		detail: 'No record found for provided ref',
		key: 'ELEMENT_NOT_FOUND',
	})

	const tree = await buildNode({
		context,
		record: root as TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
		includeFilters: include
			? [include as IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>]
			: undefined,
		exclude,
	})

	if (!tree) {
		return toTreeRecord({ record: root })
	}

	return (unwrap ? applyUnwrap({ tree, unwrapTagNames: unwrap }) : tree) as TreeRecord<
		GenericConfig,
		GenericElement
	>
}

//== Node builder

async function buildNode<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	includeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
	exclude: ExcludeFilter<GenericConfig>[] | undefined
}): Promise<TreeRecord<GenericConfig, ElementsOf<GenericConfig>> | null> {
	const { context, record, includeFilters, exclude } = params

	if (shouldStopTraversal({ record, excludeFilters: exclude })) {
		return toTreeRecord({ record })
	}

	const childrenToProcess = await fetchAndFilterChildren({
		context,
		record,
		currentIncludeFilters: includeFilters,
		excludeFilters: exclude,
	})

	const childTrees = await Promise.all(
		childrenToProcess.map(({ record: child, includeFilters: childInclude }) =>
			buildNode({ context, record: child, includeFilters: childInclude, exclude }),
		),
	)

	const validChildren = childTrees.filter(
		(t): t is TreeRecord<GenericConfig, ElementsOf<GenericConfig>> => t !== null,
	)

	return toTreeRecord({ record, tree: validChildren })
}

//== Traversal guards

function shouldStopTraversal<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	excludeFilters: ExcludeFilter<GenericConfig>[] | undefined
}): boolean {
	const { record, excludeFilters } = params
	if (!excludeFilters) return false

	return excludeFilters.some((filter) => {
		if ((filter.scope ?? 'self') !== 'children') return false
		return matchesFilter({ record, filter })
	})
}

function shouldExcludeChild<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	excludeFilters: ExcludeFilter<GenericConfig>[] | undefined
}): boolean {
	const { record, excludeFilters } = params
	if (!excludeFilters) return false

	return excludeFilters.some((filter) => {
		if ((filter.scope ?? 'self') !== 'self') return false
		return matchesFilter({ record, filter })
	})
}

//== Children fetching

async function fetchAndFilterChildren<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	currentIncludeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
	excludeFilters: ExcludeFilter<GenericConfig>[] | undefined
}): Promise<
	Array<{
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
		includeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
	}>
> {
	const { context, record, currentIncludeFilters, excludeFilters } = params

	if (!record.children?.length) return []

	const childRecords = await Promise.all(
		record.children.map((childRef) =>
			getRecord({
				context,
				ref: toRef(childRef),
			}),
		),
	)

	const children = childRecords.filter(
		(child): child is TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> =>
			child !== undefined,
	)

	const nonExcluded = children.filter(
		(child) => !shouldExcludeChild({ record: child, excludeFilters }),
	)

	return matchChildrenWithIncludeFilters({ children: nonExcluded, currentIncludeFilters })
}

//== Include filter matching

function matchChildrenWithIncludeFilters<GenericConfig extends AnyDialecteConfig>(params: {
	children: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	currentIncludeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
}): Array<{
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	includeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
}> {
	const { children, currentIncludeFilters } = params

	if (!currentIncludeFilters) {
		return children.map((child) => ({ record: child, includeFilters: undefined }))
	}

	const result: Array<{
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
		includeFilters: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>>[] | undefined
	}> = []

	for (const child of children) {
		const matchingFilter = currentIncludeFilters.find((f) =>
			matchesFilter({ record: child, filter: f }),
		)
		if (matchingFilter) {
			result.push({
				record: child,
				includeFilters: matchingFilter.children?.length ? matchingFilter.children : undefined,
			})
		}
	}

	return result
}

//== Filter predicate

function matchesFilter<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	filter: IncludeFilter<GenericConfig, ElementsOf<GenericConfig>> | ExcludeFilter<GenericConfig>
}): boolean {
	const { record, filter } = params

	if (record.tagName !== filter.tagName) return false

	if (filter.attributes) {
		return matchesAttributeFilter({
			record,
			attributeFilter: filter.attributes as Parameters<
				typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
			>[0]['attributeFilter'],
		})
	}

	return true
}

//== Unwrap

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
			if (unwrapTagNames.includes(child.tagName)) {
				return processChildren(child.tree)
			}
			return [{ ...child, tree: processChildren(child.tree) }]
		})
	}

	return { ...tree, tree: processChildren(tree.tree) }
}
