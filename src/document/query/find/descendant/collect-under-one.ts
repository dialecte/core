import { hasOmit, isOmitted, matchesFlatTarget } from './descendant-spec'
import { createRecordSource } from './record-source'

import { toRef } from '@/helpers'

import type {
	CollectedGroups,
	CollectSpecification,
	FlatTarget,
	OmitSpec,
	PathNode,
} from './descendant-spec.types'
import type { RecordSource } from './record-source'
import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * Collect under one scope element already read, reading through one per-call {@link RecordSource}: the store
 * first, each record once, then one whole-document read once the call has issued more store reads (by id or by tag
 * name) than that read is worth for this document. A flat collect under the document root with no `omit` verifies
 * no ancestry at all: it relies on every record of a document lying under its root; with an `omit` it climbs each
 * candidate's parent chain. A path collect reads level by level.
 *
 * The read behind a path collect and behind a flat collect under the document root; a flat collect under any
 * other scope is read top-down by `findDescendantsOfEach`.
 */
export async function collectUnderOne<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	root: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
	collectSpec: CollectSpecification
	omitSpec: OmitSpec
	collected: CollectedGroups<GenericConfig>
}): Promise<void> {
	const { context, root, collectSpec, omitSpec, collected } = params
	const source = createRecordSource({ context })

	if (collectSpec.mode === 'flat') {
		await traverseFlat({ context, source, root, collectSpec, omitSpec, collected })
		return
	}
	await traversePath({
		context,
		source,
		record: root,
		pathNodes: collectSpec.paths,
		omitSpec,
		collected,
	})
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
	collected: CollectedGroups<GenericConfig>
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
	collected: CollectedGroups<GenericConfig>
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
