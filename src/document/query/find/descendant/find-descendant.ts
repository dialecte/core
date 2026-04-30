import { matchesAttributeFilter, getRecord, getRecordsByTagName } from '@/document'
import { toRef } from '@/helpers'

import type { Collect, FindDescendantsParams, FindDescendantsReturn } from './find-descendant.types'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, Ref } from '@/types'

// ============================================================================
// Main export
// ============================================================================

export async function findDescendants<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericCollect extends Collect<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
	options: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>
}): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericCollect>> {
	const { context, ref, options } = params
	const { collect, omit } = options

	const omitSet = new Set<string>(omit ?? [])
	const collectSpec = parseCollect(collect)

	const collected = new Map<
		string,
		Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>
	>()

	for (const tagName of collectSpec.allTags) {
		collected.set(tagName, new Map())
	}

	const root = await getRecord({ context, ref })
	if (!root)
		return buildResult(collected) as FindDescendantsReturn<
			GenericConfig,
			GenericElement,
			GenericCollect
		>

	if (collectSpec.mode === 'flat') {
		await traverseFlat({ context, rootId: root.id, collectSpec, omitSet, collected })
	} else {
		await traversePath({ context, record: root, pathNodes: collectSpec.paths, omitSet, collected })
	}

	return buildResult(collected) as FindDescendantsReturn<
		GenericConfig,
		GenericElement,
		GenericCollect
	>
}

// ============================================================================
// Collect specification
// ============================================================================

type FlatTarget = { tagName: string; where?: Record<string, unknown> }

type PathNode = {
	tagName: string
	where?: Record<string, unknown>
	children: PathNode[]
	isLeaf: boolean
}

type CollectSpecification =
	| { mode: 'flat'; targets: FlatTarget[]; allTags: Set<string> }
	| { mode: 'path'; paths: PathNode[]; allTags: Set<string> }

/**
 * Converts the user-facing `collect` value (string | array | object) into a
 * uniform `CollectSpecification` the traversal functions consume.
 *
 * String and array forms produce `mode: 'flat'` - targets are queried by tagName index
 * and ancestry is verified bottom-up.
 * Object form produces `mode: 'path'` - traversal follows the declared nesting order.
 */
function parseCollect<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(collect: Collect<GenericConfig, GenericElement>): CollectSpecification {
	// String form
	if (typeof collect === 'string') {
		return { mode: 'flat', targets: [{ tagName: collect }], allTags: new Set([collect]) }
	}

	// Array form
	if (Array.isArray(collect)) {
		const targets: FlatTarget[] = []
		const allTags = new Set<string>()
		for (const entry of collect) {
			if (typeof entry === 'string') {
				targets.push({ tagName: entry })
				allTags.add(entry)
			} else {
				for (const [tagName, config] of Object.entries(entry)) {
					targets.push({ tagName, where: (config as { where?: Record<string, unknown> })?.where })
					allTags.add(tagName)
				}
			}
		}
		return { mode: 'flat', targets, allTags }
	}

	// Object (path) form
	const allTags = new Set<string>()
	const paths = buildPathNodes(collect as Record<string, unknown>, allTags)
	return { mode: 'path', paths, allTags }
}

function buildPathNodes(obj: Record<string, unknown>, allTags: Set<string>): PathNode[] {
	const nodes: PathNode[] = []
	for (const [tagName, value] of Object.entries(obj)) {
		if (tagName === 'where') continue
		allTags.add(tagName)

		const node = parsePathEntry({ tagName, value, allTags })
		if (node) nodes.push(node)
	}
	return nodes
}

function parsePathEntry(params: {
	tagName: string
	value: unknown
	allTags: Set<string>
}): PathNode | undefined {
	const { tagName, value, allTags } = params

	if (value === true) {
		return { tagName, where: undefined, children: [], isLeaf: true }
	}

	if (typeof value !== 'object' || value === null) return undefined

	const nested = value as Record<string, unknown>
	const where = nested.where as Record<string, unknown> | undefined
	const childKeys = Object.keys(nested).filter((key) => key !== 'where')

	if (childKeys.length === 0) {
		return { tagName, where, children: [], isLeaf: true }
	}

	const childObj: Record<string, unknown> = {}
	for (const key of childKeys) {
		childObj[key] = nested[key]
	}
	const children = buildPathNodes(childObj, allTags)
	return { tagName, where, children, isLeaf: false }
}

// ============================================================================
// Flat traversal - INDEXED bottom-up approach
// ============================================================================
// Strategy: query store by tagName index (O(matches)), then walk parent refs
// upward to verify ancestry under root. Avoids visiting all nodes in subtree.

async function traverseFlat<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	rootId: string
	collectSpec: { targets: FlatTarget[]; allTags: Set<string> }
	omitSet: Set<string>
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>
}): Promise<void> {
	const { context, rootId, collectSpec, omitSet, collected } = params

	for (const target of collectSpec.targets) {
		// omit takes precedence: if target tagName is omitted, skip entirely
		if (omitSet.has(target.tagName)) continue

		// O(matching records) via Dexie tagName index
		const candidates = await getRecordsByTagName({
			context,
			tagName: target.tagName as ElementsOf<GenericConfig>,
		})

		for (const candidate of candidates) {
			if (!matchesFlatTarget({ record: candidate, where: target.where })) continue

			// Verify ancestry: walk parent refs up to rootId
			if (await isDescendantOf({ context, record: candidate, rootId, omitSet })) {
				collected.get(target.tagName)!.set(candidate.id, candidate)
			}
		}
	}
}

function matchesFlatTarget<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	where: Record<string, unknown> | undefined
}): boolean {
	const { record, where } = params
	if (!where) return true
	return matchesAttributeFilter({
		record,
		attributeFilter: where as Parameters<
			typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
		>[0]['attributeFilter'],
	})
}

/**
 * Walk parent chain from record upward. Return true if rootId is found
 * as an ancestor AND no omitted tagName appears on the path.
 */
async function isDescendantOf<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	rootId: string
	omitSet: Set<string>
}): Promise<boolean> {
	const { context, record, rootId, omitSet } = params

	if (record.id === rootId) return true

	let current: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined = record

	while (current) {
		if (!current.parent) return false

		// Check omit on parent ref before fetching
		if (omitSet.has(current.parent.tagName)) return false

		if (current.parent.id === rootId) return true

		const parent: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined =
			await getRecord({ context, ref: toRef(current.parent) })
		if (!parent) return false

		current = parent
	}

	return false
}

// ============================================================================
// Path traversal - pre-filtered refs at each level
// ============================================================================
// Strategy: at each level, filter record.children refs by target tagName before
// fetching (same pattern as getTree). Only fetch records matching expected tagName.

async function traversePath<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	pathNodes: PathNode[]
	omitSet: Set<string>
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>
}): Promise<void> {
	const { context, record, pathNodes, omitSet, collected } = params

	if (!record.children?.length) return

	// Build set of tagNames we're looking for at this level
	const targetTagNames = new Set(pathNodes.map((p) => p.tagName))

	// Level-order search: find matching descendants for each path node (any-depth between levels)
	for (const pathNode of pathNodes) {
		const matches = await findMatchingDescendantsPrefiltered({
			context,
			record,
			tagName: pathNode.tagName,
			where: pathNode.where,
			omitSet,
			stopAtTagNames: targetTagNames,
		})

		for (const match of matches) {
			collected.get(pathNode.tagName)!.set(match.id, match)

			if (!pathNode.isLeaf && pathNode.children.length > 0) {
				await traversePath({
					context,
					record: match,
					pathNodes: pathNode.children,
					omitSet,
					collected,
				})
			}
		}
	}
}

/**
 * Level-order traversal from record, pre-filtering child refs by tagName before fetching.
 * Only fetches records that might match or lead to matches.
 */
async function findMatchingDescendantsPrefiltered<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	tagName: string
	where?: Record<string, unknown>
	omitSet: Set<string>
	stopAtTagNames: Set<string>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, record, tagName, where, omitSet, stopAtTagNames } = params

	const results: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	if (!record.children?.length) return results

	// Level-order queue of records to explore
	const queue: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	// Seed: fetch only non-omitted children
	const seedChildren = await fetchChildrenPrefiltered({ context, record, omitSet })
	queue.push(...seedChildren)

	while (queue.length > 0) {
		const current = queue.shift()!

		if (current.tagName === tagName) {
			if (matchesFlatTarget({ record: current, where })) results.push(current)
			// Don't descend into matched nodes (they become new root for child paths)
			continue
		}

		// Don't descend into nodes that match OTHER path targets at this level
		// (they'll be handled by their own pathNode iteration)
		if (stopAtTagNames.has(current.tagName) && current.tagName !== tagName) continue

		// Continue searching deeper
		if (current.children?.length) {
			const grandchildren = await fetchChildrenPrefiltered({ context, record: current, omitSet })
			queue.push(...grandchildren)
		}
	}

	return results
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fetch children with omit pre-filtering on refs (avoids fetching omitted records).
 */
async function fetchChildrenPrefiltered<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	omitSet: Set<string>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, record, omitSet } = params

	if (!record.children?.length) return []

	const relevantRefs = record.children.filter((ref) => !omitSet.has(ref.tagName))
	if (!relevantRefs.length) return []

	const records = await Promise.all(
		relevantRefs.map((childRef) => getRecord({ context, ref: toRef(childRef) })),
	)

	return records.filter(
		(r): r is TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> => r !== undefined,
	)
}

function buildResult<GenericConfig extends AnyDialecteConfig>(
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>,
): Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const result: Record<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> = {}
	for (const [tagName, recordMap] of collected.entries()) {
		result[tagName] = Array.from(recordMap.values())
	}
	return result
}
