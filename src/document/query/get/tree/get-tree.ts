import {
	applyUnwrap,
	applyOrder,
	parseOmit,
	isOmitted,
	shouldStopTraversal,
} from '../../tree-filter'

import { matchesAttributeFilter, getRecord } from '@/document'
import { toRef, toTreeRecord } from '@/helpers'
import { invariant } from '@/utils'

import type { OmitSpecification } from '../../tree-filter'
import type { GetTreeParams, TreeSelect } from './get-tree.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, TreeRecord } from '@/types'

//== Main export

export async function getTree<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options?: GetTreeParams<GenericConfig, GenericElement>
	dialecteConfig?: GenericConfig
}): Promise<TreeRecord<GenericConfig, GenericElement> | undefined> {
	const { context, ref, options = {}, dialecteConfig } = params
	const { select, omit, unwrap } = options

	const root = await getRecord({ context, ref })
	invariant(root, {
		detail: 'No record found for provided ref',
		key: 'ELEMENT_NOT_FOUND',
	})

	const compiledOmit = parseOmit(omit)
	const transparentElements = context.dialecteConfig.transparentElements as
		| readonly string[]
		| undefined

	const tree = await buildNode({
		context,
		record: root as TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
		select: select as TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined,
		compiledOmit,
		dialecteConfig,
		transparentElements,
	})

	if (!tree) {
		return toTreeRecord({ record: root })
	}

	// Auto-unwrap transparent elements when unwrap is not explicitly provided
	const unwrapTagNames = unwrap ?? (transparentElements?.length ? transparentElements : undefined)

	const unwrapped = unwrapTagNames
		? applyUnwrap({ tree, unwrapTagNames: unwrapTagNames as ElementsOf<GenericConfig>[] })
		: tree

	// Final post-pass: order children by the config sequence (matches XML order).
	return applyOrder({
		tree: unwrapped,
		childrenConfig: context.dialecteConfig.children,
	}) as TreeRecord<GenericConfig, GenericElement>
}

//== Node builder

async function buildNode<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	compiledOmit: OmitSpecification<GenericConfig>
	dialecteConfig?: GenericConfig
	transparentElements?: readonly string[]
}): Promise<TreeRecord<GenericConfig, ElementsOf<GenericConfig>> | null> {
	const { context, record, select, compiledOmit, dialecteConfig, transparentElements } = params

	// Stop traversal if omit scope=children matches
	if (shouldStopTraversal({ record, compiledOmit })) {
		return toTreeRecord({ record })
	}

	const childrenToProcess = await fetchAndFilterChildren({
		context,
		record,
		select,
		compiledOmit,
		dialecteConfig,
		transparentElements,
	})

	const childTrees = await Promise.all(
		childrenToProcess.map(({ record: child, select: childSelect }) =>
			buildNode({
				context,
				record: child,
				select: childSelect,
				compiledOmit,
				dialecteConfig,
				transparentElements,
			}),
		),
	)

	const validChildren = childTrees.filter(
		(t): t is TreeRecord<GenericConfig, ElementsOf<GenericConfig>> => t !== null,
	)

	return toTreeRecord({ record, tree: validChildren })
}

//== Children fetching with pre-filtering

async function fetchAndFilterChildren<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	compiledOmit: OmitSpecification<GenericConfig>
	dialecteConfig?: GenericConfig
	transparentElements?: readonly string[]
}): Promise<
	Array<{
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
		select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	}>
> {
	const { context, record, select, compiledOmit, dialecteConfig, transparentElements } = params

	if (!record.children?.length) return []

	// Extract allowed tagNames from select keys (PascalCase only, skip config keys)
	const selectKeys = select ? getSelectElementKeys(select) : undefined

	// Auto-recursion: if element is self-recursive per config and no explicit self-key in select,
	// include self tagName in selectKeys so self-referencing children are fetched
	if (selectKeys && select && dialecteConfig && select.recursive !== false) {
		const selfTag = record.tagName
		const childrenOfSelf = (dialecteConfig.children as Record<string, readonly string[]>)[selfTag]
		const hasExplicitSelfKey = (select as Record<string, unknown>)[selfTag] !== undefined
		if (childrenOfSelf?.includes(selfTag) && !hasExplicitSelfKey) {
			selectKeys.add(selfTag)
		}
	}

	// Pre-filter child refs by tagName before fetching records
	const relevantRefs = record.children.filter((childRef) =>
		shouldFetchChildRef({
			tagName: childRef.tagName,
			compiledOmit,
			selectKeys,
			transparentElements,
		}),
	)

	if (!relevantRefs.length) return []

	const childRecords = await Promise.all(
		relevantRefs.map((childRef) =>
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

	// Apply conditional omit (requires record attributes)
	const nonOmitted = children.filter((child) => !isOmitted({ record: child, compiledOmit }))

	// Apply where filter from select and resolve child select
	return resolveChildSelect({
		children: nonOmitted,
		select,
		record,
		dialecteConfig,
		transparentElements,
	})
}

//== Select resolution

function shouldFetchChildRef<GenericConfig extends AnyDialecteConfig>(params: {
	tagName: string
	compiledOmit: OmitSpecification<GenericConfig>
	selectKeys: Set<string> | undefined
	transparentElements?: readonly string[]
}): boolean {
	const { tagName, compiledOmit, selectKeys, transparentElements } = params
	if (compiledOmit.unconditional.has(tagName)) return false
	if (selectKeys && !selectKeys.has(tagName)) {
		// Always fetch transparent elements so their children can be matched
		if (transparentElements?.includes(tagName)) return true
		return false
	}
	return true
}

const CONFIG_KEYS = new Set(['where', 'recursive'])

function getSelectElementKeys<GenericConfig extends AnyDialecteConfig>(
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>,
): Set<string> {
	const keys = new Set<string>()
	for (const key of Object.keys(select)) {
		if (!CONFIG_KEYS.has(key)) keys.add(key)
	}
	return keys
}

function resolveChildSelect<GenericConfig extends AnyDialecteConfig>(params: {
	children: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig?: GenericConfig
	transparentElements?: readonly string[]
}): Array<{
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
}> {
	const { children, select, record, dialecteConfig, transparentElements } = params

	// No select = include all descendants
	if (!select) {
		return children.map((child) => ({ record: child, select: undefined }))
	}

	const result: Array<{
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
		select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	}> = []

	for (const child of children) {
		const entry = (select as Record<string, unknown>)[child.tagName]

		// Transparent element without explicit select entry: pass parent select through
		if (entry === undefined && transparentElements?.includes(child.tagName)) {
			result.push({ record: child, select })
			continue
		}

		// Auto-recursion: child has same tagName as parent and is self-recursive per config
		if (entry === undefined && child.tagName === record.tagName) {
			const resolved = resolveAutoRecursion({ child, select, dialecteConfig })
			if (resolved) {
				result.push(resolved)
				continue
			}
		}

		if (entry === undefined || entry === false) continue

		if (entry === true) {
			result.push({ record: child, select: undefined })
			continue
		}

		const resolved = resolveNestedSelect({ child, entry, parentRecord: record })
		if (resolved) result.push(resolved)
	}

	return result
}

function resolveAutoRecursion<GenericConfig extends AnyDialecteConfig>(params: {
	child: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig?: GenericConfig
}):
	| {
			record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
			select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>
	  }
	| undefined {
	const { child, select, dialecteConfig } = params
	if (!dialecteConfig || select.recursive === false) return undefined

	const childrenOfTag = (dialecteConfig.children as Record<string, readonly string[]>)[
		child.tagName
	]
	if (!childrenOfTag?.includes(child.tagName)) return undefined

	// Apply where filter from select to auto-recursed child
	if (select.where) {
		const matches = matchesAttributeFilter({
			record: child,
			attributeFilter: select.where as Parameters<
				typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
			>[0]['attributeFilter'],
		})
		if (!matches) return undefined
	}

	return { record: child, select }
}

function resolveNestedSelect<GenericConfig extends AnyDialecteConfig>(params: {
	child: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	entry: unknown
	parentRecord: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
}):
	| {
			record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
			select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	  }
	| undefined {
	const { child, entry, parentRecord } = params
	const childSelect = entry as TreeSelect<GenericConfig, ElementsOf<GenericConfig>>

	// Check where filter - applies to the child element's own attributes
	if (childSelect.where) {
		const childMatches = matchesAttributeFilter({
			record: child,
			attributeFilter: childSelect.where as Parameters<
				typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
			>[0]['attributeFilter'],
		})
		if (!childMatches) return undefined
	}

	// Handle recursive: if child has same tagName as parent and recursive is set
	if (childSelect.recursive && child.tagName === parentRecord.tagName) {
		const nextRecursive = childSelect.recursive === true ? true : childSelect.recursive - 1
		if (nextRecursive === 0) return undefined
		return { record: child, select: { ...childSelect, recursive: nextRecursive } }
	}

	if (childSelect.recursive) {
		return { record: child, select: injectRecursive(childSelect, child.tagName) }
	}

	// Explicit self-key without recursive: suppress auto-recursion at deeper levels
	if (child.tagName === parentRecord.tagName) {
		return { record: child, select: { ...childSelect, recursive: false } }
	}

	return { record: child, select: childSelect }
}

/**
 * For recursive select: when a child matches a recursive entry, re-inject that
 * entry's parent select as the child's select so that self-referencing children
 * get the same filter applied.
 */
function injectRecursive<GenericConfig extends AnyDialecteConfig>(
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>,
	selfTagName: string,
): TreeSelect<GenericConfig, ElementsOf<GenericConfig>> {
	// Check if selfTagName is one of the keys in this select
	const selfEntry = (select as Record<string, unknown>)[selfTagName]
	if (!selfEntry || selfEntry === true || selfEntry === false) return select

	// The self-entry has recursive flag - it will be re-applied at the next level
	return select
}
