import { isOmitted, shouldStopTraversal } from '../../tree-filter'
import { CONFIG_KEYS } from './get-tree.constants'

import { matchesAttributeFilter } from '@/document'

import type { OmitSpecification } from '../../tree-filter'
import type { RecordLink } from '../record/known-records.types'
import type { TreeSelect } from './get-tree.types'
import type { KeptChild, TreeShaping } from './tree-children.types'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * Whether a node of the tree expands its children: not at the depth boundary (the node is kept, its subtree
 * dropped), nor on an `omit` entry of scope `children` its attributes match.
 *
 * @internal shared by the tree loader and the tree assembly of `getTree`
 */
export function expandsChildren<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	remainingDepth: number
	compiledOmit: OmitSpecification<GenericConfig>
}): boolean {
	const { record, remainingDepth, compiledOmit } = params
	return remainingDepth > 0 && !shouldStopTraversal({ record, compiledOmit })
}

/**
 * The child refs of a record a tree can keep, decided from their tag alone, before any of them is read: the
 * `select` keys at this level (the record's own tag too when it recurses into itself), the transparent elements
 * `unwrap` sees through, and no unconditionally omitted tag.
 *
 * @internal shared by the tree loader and the tree assembly of `getTree`
 */
export function childRefsToRead<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	shaping: TreeShaping<GenericConfig>
}): RecordLink[] {
	const { record, select, shaping } = params
	if (!record.children?.length) return []
	const selectKeys = select ? selectKeysOf<GenericConfig>({ record, select, shaping }) : undefined
	return record.children.filter((childRef) =>
		isReadable<GenericConfig>({ tagName: childRef.tagName, selectKeys, shaping }),
	)
}

/**
 * The children read for a record that the tree keeps, each with the `select` of its own children: the
 * conditional `omit` entries and the `where` filters are checked against their attributes.
 *
 * @internal shared by the tree loader and the tree assembly of `getTree`
 */
export function keptChildren<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	children: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	shaping: TreeShaping<GenericConfig>
}): KeptChild<GenericConfig>[] {
	const { record, children, select, shaping } = params
	const nonOmitted = children.filter(
		(child) => !isOmitted({ record: child, compiledOmit: shaping.compiledOmit }),
	)
	return resolveChildSelect<GenericConfig>({
		filterConfig: shaping.compiledOmit.dialecteConfig,
		children: nonOmitted,
		select,
		record,
		dialecteConfig: shaping.dialecteConfig,
		transparentElements: shaping.transparentElements,
	})
}

//== Select keys

/**
 * The element keys of a `select` (its config keys aside), with the record's own tag when it is self-recursive per
 * the dialecte and the select names no self key (auto-recursion).
 */
function selectKeysOf<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>
	shaping: TreeShaping<GenericConfig>
}): Set<string> {
	const { record, select, shaping } = params
	const keys = new Set(Object.keys(select).filter((key) => !CONFIG_KEYS.has(key)))
	const { dialecteConfig } = shaping
	if (!dialecteConfig || select.recursive === false) return keys

	const selfTag = record.tagName
	const childrenOfSelf = (dialecteConfig.children as Record<string, readonly string[]>)[selfTag]
	const hasExplicitSelfKey = (select as Record<string, unknown>)[selfTag] !== undefined
	if (childrenOfSelf?.includes(selfTag) && !hasExplicitSelfKey) keys.add(selfTag)
	return keys
}

/** Whether a child of this tag can be kept: not omitted, and selected or transparent when a select narrows. */
function isReadable<GenericConfig extends AnyDialecteConfig>(params: {
	tagName: string
	selectKeys: Set<string> | undefined
	shaping: TreeShaping<GenericConfig>
}): boolean {
	const { tagName, selectKeys, shaping } = params
	if (shaping.compiledOmit.unconditional.has(tagName)) return false
	if (!selectKeys || selectKeys.has(tagName)) return true
	// a transparent element is kept so that its children can be matched
	return shaping.transparentElements?.includes(tagName) ?? false
}

//== Select resolution

function resolveChildSelect<GenericConfig extends AnyDialecteConfig>(params: {
	children: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>> | undefined
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig?: GenericConfig
	/** The dialecte the `where` filters are read against (an `xsi:type` value names a type of it). */
	filterConfig: GenericConfig
	transparentElements?: readonly string[]
}): KeptChild<GenericConfig>[] {
	const { children, select, record, dialecteConfig, filterConfig, transparentElements } = params

	// No select = include all descendants
	if (!select) {
		return children.map((child) => ({ record: child, select: undefined }))
	}

	return children.flatMap((child) => {
		const entry = (select as Record<string, unknown>)[child.tagName]

		// Transparent element without explicit select entry: pass parent select through
		if (entry === undefined && transparentElements?.includes(child.tagName)) {
			return [{ record: child, select }]
		}

		// Auto-recursion: child has same tagName as parent and is self-recursive per config
		if (entry === undefined && child.tagName === record.tagName) {
			const resolved = resolveAutoRecursion<GenericConfig>({
				child,
				select,
				dialecteConfig,
				filterConfig,
			})
			if (resolved) return [resolved]
		}

		if (entry === undefined || entry === false) return []
		if (entry === true) return [{ record: child, select: undefined }]

		const resolved = resolveNestedSelect<GenericConfig>({
			child,
			entry,
			parentRecord: record,
			filterConfig,
		})
		return resolved ? [resolved] : []
	})
}

function resolveAutoRecursion<GenericConfig extends AnyDialecteConfig>(params: {
	child: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	select: TreeSelect<GenericConfig, ElementsOf<GenericConfig>>
	dialecteConfig?: GenericConfig
	/** The dialecte the `where` filters are read against (an `xsi:type` value names a type of it). */
	filterConfig: GenericConfig
}): KeptChild<GenericConfig> | undefined {
	const { child, select, dialecteConfig, filterConfig } = params
	if (!dialecteConfig || select.recursive === false) return undefined

	const childrenOfTag = (dialecteConfig.children as Record<string, readonly string[]>)[
		child.tagName
	]
	if (!childrenOfTag?.includes(child.tagName)) return undefined

	// Apply where filter from select to auto-recursed child
	if (select.where) {
		const matches = matchesAttributeFilter({
			dialecteConfig: filterConfig,
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
	/** The dialecte the `where` filters are read against (an `xsi:type` value names a type of it). */
	filterConfig: GenericConfig
}): KeptChild<GenericConfig> | undefined {
	const { child, entry, parentRecord, filterConfig } = params
	const childSelect = entry as TreeSelect<GenericConfig, ElementsOf<GenericConfig>>

	// Check where filter - applies to the child element's own attributes
	if (childSelect.where) {
		const childMatches = matchesAttributeFilter({
			dialecteConfig: filterConfig,
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

	// a recursive entry is re-applied as is on the self-referencing children below
	if (childSelect.recursive) return { record: child, select: childSelect }

	// Explicit self-key without recursive: suppress auto-recursion at deeper levels
	if (child.tagName === parentRecord.tagName) {
		return { record: child, select: { ...childSelect, recursive: false } }
	}

	return { record: child, select: childSelect }
}
