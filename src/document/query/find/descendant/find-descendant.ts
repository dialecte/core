import { createRecordSource } from './record-source'

import { matchesAttributeFilter } from '@/document'
import { toRef } from '@/helpers'

import type { Collect, FindDescendantsParams, FindDescendantsReturn } from './find-descendant.types'
import type { RecordSource } from './record-source'
import type { Context, Ref, OmitEntry } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

// ============================================================================
// Main export
// ============================================================================

/**
 * Collect the descendants of `ref` by tag name.
 *
 * Reads: the records come from one per-call {@link RecordSource} - the store first, each
 * record once, then one whole-document read once the call has issued more store reads (by id
 * or by tag name) than that read is worth for this document. A flat collect under the document
 * root with no `omit` verifies no ancestry at all: it relies on every record of a document
 * lying under its root.
 *
 * Order: the groups are keyed by tag name; the records of a group come in no guaranteed order
 * (the store's own; it is not guaranteed to be document order).
 */
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

	const omitSpec = parseOmitEntries({ omit, dialecteConfig: context.dialecteConfig })
	const collectSpec = parseCollect(collect)

	const collected = new Map<
		string,
		Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>
	>()

	for (const tagName of collectSpec.allTags) {
		collected.set(tagName, new Map())
	}

	const source = createRecordSource({ context })
	const root = await source.get(ref)
	if (!root)
		return buildResult(collected) as FindDescendantsReturn<
			GenericConfig,
			GenericElement,
			GenericCollect
		>

	if (collectSpec.mode === 'flat') {
		await traverseFlat({ context, source, root, collectSpec, omitSpec, collected })
	} else {
		await traversePath({
			context,
			source,
			record: root,
			pathNodes: collectSpec.paths,
			omitSpec,
			collected,
		})
	}

	return buildResult(collected) as FindDescendantsReturn<
		GenericConfig,
		GenericElement,
		GenericCollect
	>
}

// ============================================================================
// Omit specification
// ============================================================================

type OmitSpec = {
	/** The dialecte the `where` filters are read against (an `xsi:type` value names a type of it). */
	dialecteConfig: AnyDialecteConfig
	unconditional: Set<string>
	conditional: Array<{
		tagName: string
		where: Record<string, unknown>
	}>
}

function parseOmitEntries<GenericConfig extends AnyDialecteConfig>(params: {
	omit: OmitEntry<GenericConfig>[] | undefined
	dialecteConfig: GenericConfig
}): OmitSpec {
	const { omit, dialecteConfig } = params
	const unconditional = new Set<string>()
	const conditional: OmitSpec['conditional'] = []

	if (!omit) return { dialecteConfig, unconditional, conditional }

	for (const entry of omit) {
		if (typeof entry === 'string') {
			unconditional.add(entry)
		} else {
			const tagName = Object.keys(entry)[0]
			const config = (entry as Record<string, { where?: Record<string, unknown> }>)[tagName]
			if (!config?.where) {
				unconditional.add(tagName)
			} else {
				conditional.push({ tagName, where: config.where })
			}
		}
	}
	return { dialecteConfig, unconditional, conditional }
}

function hasOmit(omitSpec: OmitSpec): boolean {
	return omitSpec.unconditional.size > 0 || omitSpec.conditional.length > 0
}

function isOmitted<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	omitSpec: OmitSpec
}): boolean {
	const { record, omitSpec } = params
	if (omitSpec.unconditional.has(record.tagName)) return true
	for (const cond of omitSpec.conditional) {
		if (cond.tagName !== record.tagName) continue
		if (
			matchesAttributeFilter({
				dialecteConfig: omitSpec.dialecteConfig as GenericConfig,
				record,
				attributeFilter: cond.where as Parameters<
					typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
				>[0]['attributeFilter'],
			})
		)
			return true
	}
	return false
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
// Flat traversal - indexed bottom-up
// ============================================================================
// Strategy: the candidates of a tag come from the store's tagName index (O(matches)), and
// each one is kept when its parent chain reaches the root without crossing an omitted record.
// The chain is climbed through the record source: each ancestor is read once per call, and
// the climb gives way to one whole-document read once it has cost more than that read.

async function traverseFlat<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	source: RecordSource<GenericConfig>
	root: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	collectSpec: { targets: FlatTarget[]; allTags: Set<string> }
	omitSpec: OmitSpec
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>
}): Promise<void> {
	const { context, source, root, collectSpec, omitSpec, collected } = params

	// Under the document root with nothing omitted, every record of the document qualifies.
	const everyRecordQualifies = !root.parent && !hasOmit(omitSpec)
	const ancestry = createAncestryCheck({ source, rootId: root.id, omitSpec })

	for (const target of collectSpec.targets) {
		// omit takes precedence: if target tagName is unconditionally omitted, skip entirely
		if (omitSpec.unconditional.has(target.tagName)) continue

		const candidates = await source.byTag(target.tagName as ElementsOf<GenericConfig>)

		for (const candidate of candidates) {
			if (
				!matchesFlatTarget({
					dialecteConfig: context.dialecteConfig,
					record: candidate,
					where: target.where,
				})
			)
				continue
			if (
				everyRecordQualifies
					? !isOmitted({ record: candidate, omitSpec })
					: await ancestry.isUnderRoot(candidate)
			) {
				collected.get(target.tagName)!.set(candidate.id, candidate)
			}
		}
	}
}

function matchesFlatTarget<GenericConfig extends AnyDialecteConfig>(params: {
	dialecteConfig: GenericConfig
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	where: Record<string, unknown> | undefined
}): boolean {
	const { dialecteConfig, record, where } = params
	if (!where) return true
	return matchesAttributeFilter({
		dialecteConfig,
		record,
		attributeFilter: where as Parameters<
			typeof matchesAttributeFilter<GenericConfig, ElementsOf<GenericConfig>>
		>[0]['attributeFilter'],
	})
}

/**
 * Whether a record lies under the root, neither it nor any record on the way up omitted. The verdict of
 * every record climbed through is kept, so sibling candidates (and the candidates of a later
 * tag) settle on a shared ancestor without climbing it again.
 */
function createAncestryCheck<GenericConfig extends AnyDialecteConfig>(params: {
	source: RecordSource<GenericConfig>
	rootId: string
	omitSpec: OmitSpec
}): {
	isUnderRoot(record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>): Promise<boolean>
} {
	const { source, rootId, omitSpec } = params
	/** id → under the root, with the path from that record (included) up to the root clean. */
	const verdicts = new Map<string, boolean>()

	async function isUnderRoot(
		record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>,
	): Promise<boolean> {
		// An omitted record is out whatever lies above it; its verdict is not kept, as no climb
		// passes through it (a climb stops at the first omitted ancestor)
		if (isOmitted({ record, omitSpec })) return false
		if (record.id === rootId) return true

		const climbed: string[] = [record.id]
		let current = record
		let verdict: boolean

		for (;;) {
			const parentRef = current.parent
			if (!parentRef) {
				verdict = false
				break
			}
			// Unconditional omit is decided on the ref, before reading the parent - the root's own
			// tag included, as the climb always has
			if (omitSpec.unconditional.has(parentRef.tagName)) {
				verdict = false
				break
			}
			if (parentRef.id === rootId) {
				verdict = true
				break
			}
			const known = verdicts.get(parentRef.id)
			if (known !== undefined) {
				verdict = known
				break
			}
			const parent = await source.get(toRef(parentRef))
			if (!parent || isOmitted({ record: parent, omitSpec })) {
				verdicts.set(parentRef.id, false)
				verdict = false
				break
			}
			climbed.push(parent.id)
			current = parent
		}

		for (const id of climbed) verdicts.set(id, verdict)
		return verdict
	}

	return { isUnderRoot }
}

// ============================================================================
// Path traversal - pre-filtered refs at each level
// ============================================================================
// Strategy: at each level, filter record.children refs by target tagName before
// fetching (same pattern as getTree). Only fetch records matching expected tagName.

async function traversePath<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	source: RecordSource<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	pathNodes: PathNode[]
	omitSpec: OmitSpec
	collected: Map<string, Map<string, TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>>>
}): Promise<void> {
	const { context, source, record, pathNodes, omitSpec, collected } = params

	if (!record.children?.length) return

	// Build set of tagNames we're looking for at this level
	const targetTagNames = new Set(pathNodes.map((p) => p.tagName))

	// Level-order search: find matching descendants for each path node (any-depth between levels)
	for (const pathNode of pathNodes) {
		const matches = await findMatchingDescendantsPrefiltered({
			context,
			source,
			record,
			tagName: pathNode.tagName,
			where: pathNode.where,
			omitSpec,
			stopAtTagNames: targetTagNames,
		})

		for (const match of matches) {
			collected.get(pathNode.tagName)!.set(match.id, match)

			if (!pathNode.isLeaf && pathNode.children.length > 0) {
				await traversePath({
					context,
					source,
					record: match,
					pathNodes: pathNode.children,
					omitSpec,
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
	source: RecordSource<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	tagName: string
	where?: Record<string, unknown>
	omitSpec: OmitSpec
	stopAtTagNames: Set<string>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { context, source, record, tagName, where, omitSpec, stopAtTagNames } = params

	const results: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	if (!record.children?.length) return results

	// Level-order queue of records to explore
	const queue: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[] = []

	// Seed: fetch only non-omitted children
	const seedChildren = await fetchChildrenPrefiltered({ source, record, omitSpec })
	queue.push(...seedChildren)

	while (queue.length > 0) {
		const current = queue.shift()!

		if (current.tagName === tagName) {
			if (matchesFlatTarget({ dialecteConfig: context.dialecteConfig, record: current, where }))
				results.push(current)
			// Don't descend into matched nodes (they become new root for child paths)
			continue
		}

		// Don't descend into nodes that match OTHER path targets at this level
		// (they'll be handled by their own pathNode iteration)
		if (stopAtTagNames.has(current.tagName) && current.tagName !== tagName) continue

		// Continue searching deeper
		if (current.children?.length) {
			const grandchildren = await fetchChildrenPrefiltered({ source, record: current, omitSpec })
			queue.push(...grandchildren)
		}
	}

	return results
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fetch children with omit pre-filtering on refs (avoids fetching unconditionally omitted records).
 * Conditional omit entries are checked after fetching.
 */
async function fetchChildrenPrefiltered<GenericConfig extends AnyDialecteConfig>(params: {
	source: RecordSource<GenericConfig>
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	omitSpec: OmitSpec
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[]> {
	const { source, record, omitSpec } = params

	if (!record.children?.length) return []

	const relevantRefs = record.children.filter((ref) => !omitSpec.unconditional.has(ref.tagName))
	if (!relevantRefs.length) return []

	const records = await source.getMany(relevantRefs.map((childRef) => toRef(childRef)))

	return records.filter(
		(r): r is TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> =>
			r !== undefined && !isOmitted({ record: r, omitSpec }),
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
