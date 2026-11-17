import { getRecords } from '../../get/record'
import { isRecordGiven } from '../../get/record/is-record-given'
import { readUnknownRecords } from '../../get/record/read-unknown-records'
import { collectUnderOne } from './collect-under-one'
import {
	buildResult,
	emptyGroups,
	isOmitted,
	matchesFlatTarget,
	parseCollect,
	parseOmitEntries,
} from './descendant-spec'

import { toRef } from '@/helpers'
import { compareById } from '@/store/compare-by-id'

import type { KnownRecords, RecordLink } from '../../get/record/known-records.types'
import type {
	CollectedGroups,
	CollectSpecification,
	FlatTarget,
	OmitSpec,
} from './descendant-spec.types'
import type { Collect, FindDescendantsParams, FindDescendantsReturn } from './find-descendant.types'
import type {
	AnyTracked,
	TargetsByTag,
	WalkNode,
	WalkScope,
} from './find-descendants-of-each.types'
import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * What `findDescendants` answers for each element given, one answer per input position, in the input order.
 *
 * A record given is used as given (its `children` are followed, it is not read again); the refs are read together
 * in one `getRecords` (staged operations first). A flat collect under elements that are not the document root then reads top-down, one `getRecords`
 * per level over every element's subtree at once, following only the children that can hold a collected tag (see
 * {@link createFollowCheck}); an unconditionally omitted tag is never read, a record a conditional `omit` matches
 * is neither collected nor followed. A record under two elements given (nested scopes) is answered for both; an
 * element given twice is answered at each position; each position after the first gets its own shallow copy of a
 * record. Each tag's records come in id order. A path collect, and a flat collect under the document root, read
 * as `findDescendants` always has, per element. A ref that names no element answers empty groups.
 *
 * Without options, each element collects every descendant tag its own tag may hold, as `findDescendants` does.
 *
 * Perf: one `core::store::getMany` for the refs (none when every input is a record), then at most one per level of the deepest subtree walked;
 * no `get`, tag read or whole-document read for a flat collect under a non-root.
 *
 * @internal the context-level read behind `doc.query.findDescendantsOfEach`; callers use the query
 */
export async function findDescendantsOfEach<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericCollect extends Collect<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
	options?: FindDescendantsParams<GenericConfig, GenericElement, GenericCollect>
}): Promise<FindDescendantsReturn<GenericConfig, GenericElement, GenericCollect>[]> {
	const { context, refsOrRecords, options } = params
	if (!options) {
		const answers = await collectAllOfEach({ context, refsOrRecords })
		return answers as unknown as FindDescendantsReturn<
			GenericConfig,
			GenericElement,
			GenericCollect
		>[]
	}

	const collectSpec = parseCollect<GenericConfig, GenericElement>(options.collect)
	const omitSpec = parseOmitEntries({ omit: options.omit, dialecteConfig: context.dialecteConfig })
	const scopes = await readScopes({ context, refsOrRecords })
	const answers = scopes.map(() => emptyGroups<GenericConfig>(collectSpec))

	const walked: WalkScope<GenericConfig>[] = []
	const eachAlone: Promise<void>[] = []
	for (const [position, scope] of scopes.entries()) {
		if (!scope) continue
		if (collectSpec.mode === 'flat' && scope.parent) {
			walked.push({ position, record: scope })
			continue
		}
		eachAlone.push(
			collectUnderOne({
				context,
				root: scope,
				collectSpec,
				omitSpec,
				collected: answers[position],
			}),
		)
	}
	const walks =
		collectSpec.mode === 'flat'
			? distinctScopeWalks({ scopes: walked }).map((scopes) =>
					walkTopDown({ context, scopes, collectSpec, omitSpec, answers }),
				)
			: []
	await Promise.all([...walks, ...eachAlone])

	const results = answers.map((collected) => buildResult<GenericConfig>(collected))
	return results as unknown as FindDescendantsReturn<
		GenericConfig,
		GenericElement,
		GenericCollect
	>[]
}

/**
 * The scope of each input position: a record given as given, the refs read together in one `getRecords`; `undefined`
 * for a ref that names no element.
 */
async function readScopes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
}): Promise<(AnyTracked<GenericConfig> | undefined)[]> {
	const { context, refsOrRecords } = params
	const scopes: (AnyTracked<GenericConfig> | undefined)[] = refsOrRecords.map((refOrRecord) =>
		isRecordGiven(refOrRecord) ? (refOrRecord as AnyTracked<GenericConfig>) : undefined,
	)
	const refPositions = [...refsOrRecords.keys()].filter(
		(position) => !isRecordGiven(refsOrRecords[position]),
	)
	if (refPositions.length === 0) return scopes

	const records = await getRecords({
		context,
		refs: refPositions.map((position) => toRef(refsOrRecords[position])),
	})
	for (const [index, record] of records.entries()) scopes[refPositions[index]] = record
	return scopes
}

/** Without options: each element collects every tag its own tag may hold, one walk per tag name of the elements. */
async function collectAllOfEach<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
}): Promise<Record<string, AnyTracked<GenericConfig>[]>[]> {
	const { context, refsOrRecords } = params
	const positionsByTag = new Map<string, number[]>()
	for (const [position, refOrRecord] of refsOrRecords.entries()) {
		const positions = positionsByTag.get(refOrRecord.tagName)
		if (positions) positions.push(position)
		else positionsByTag.set(refOrRecord.tagName, [position])
	}

	const answers: Record<string, AnyTracked<GenericConfig>[]>[] = refsOrRecords.map(() => ({}))
	const descendants = context.dialecteConfig.descendants as Record<string, readonly string[]>
	await Promise.all(
		[...positionsByTag].map(async function collectAllOfTag([tagName, positions]) {
			const collect = [...(descendants[tagName] ?? [])] as Collect<GenericConfig, GenericElement>
			const ofTag = (await findDescendantsOfEach<
				GenericConfig,
				GenericElement,
				Collect<GenericConfig, GenericElement>
			>({
				context,
				refsOrRecords: positions.map((position) => refsOrRecords[position]),
				options: { collect },
			})) as unknown as Record<string, AnyTracked<GenericConfig>[]>[]
			for (const [index, position] of positions.entries()) answers[position] = ofTag[index]
		}),
	)
	return answers
}

// ============================================================================
// Top-down walk
// ============================================================================

/**
 * The scopes split into walks whose scopes have distinct ids. An element given again with other content (a record read
 * at another time than its ref) walks apart, so each position answers from the record it gave; an element given again
 * with the same content shares the walk. One walk in the usual call.
 */
function distinctScopeWalks<GenericConfig extends AnyDialecteConfig>(params: {
	scopes: WalkScope<GenericConfig>[]
}): WalkScope<GenericConfig>[][] {
	const walks: { scopes: WalkScope<GenericConfig>[]; contentById: Map<string, string> }[] = []
	for (const scope of params.scopes) {
		const { id } = scope.record
		const content = JSON.stringify([scope.record.attributes, scope.record.children])
		const walk = walks.find(({ contentById }) => {
			const held = contentById.get(id)
			return held === undefined || held === content
		})
		if (walk) {
			walk.scopes.push(scope)
			walk.contentById.set(id, content)
		} else {
			walks.push({ scopes: [scope], contentById: new Map([[id, content]]) })
		}
	}
	return walks.map(({ scopes }) => scopes)
}

/**
 * Reads the subtrees of every scope at once, one `getRecords` per level, and fills each scope's answer. Each
 * record is read once, however many scopes hold it; a scope reached by another scope's walk is linked to it, so
 * what lies under it counts for both.
 */
async function walkTopDown<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	scopes: WalkScope<GenericConfig>[]
	collectSpec: Extract<CollectSpecification, { mode: 'flat' }>
	omitSpec: OmitSpec
	answers: CollectedGroups<GenericConfig>[]
}): Promise<void> {
	const { context, scopes, collectSpec, omitSpec, answers } = params
	const targets = targetsByTag({ targets: collectSpec.targets, omitSpec })
	// every collected tag unconditionally omitted: nothing to read
	if (targets.size === 0) return
	const follows = createFollowCheck({
		dialecteConfig: context.dialecteConfig,
		collected: new Set(targets.keys()),
	})
	const nodes = new Map<string, WalkNode<GenericConfig>>()
	/** Every record this walk holds, kept or omitted: never read twice. */
	const known: KnownRecords<GenericConfig> = new Map()

	let frontier: WalkNode<GenericConfig>[] = []
	for (const { position, record } of scopes) {
		const given = nodes.get(record.id)
		if (given) {
			given.scopeOf.push(position)
			continue
		}
		const node: WalkNode<GenericConfig> = { record, scopeOf: [position] }
		nodes.set(record.id, node)
		known.set(record.id, record)
		// an unconditionally omitted scope tag holds nothing: the climb stopped at it
		if (!omitSpec.unconditional.has(record.tagName)) frontier.push(node)
	}

	while (frontier.length > 0) {
		const links: RecordLink[] = []
		const parentOf = new Map<string, string>()
		for (const node of frontier) {
			for (const child of node.record.children ?? []) {
				if (omitSpec.unconditional.has(child.tagName)) continue
				if (!targets.has(child.tagName) && !follows(child.tagName)) continue
				const scope = nodes.get(child.id)
				// a scope another scope's walk reaches: linked, already walked
				if (scope) {
					if (!isOmitted({ record: scope.record, omitSpec })) scope.parentId = node.record.id
					continue
				}
				links.push(child)
				parentOf.set(child.id, node.record.id)
			}
		}
		if (links.length === 0) break

		const found = await readUnknownRecords({ context, links, known })
		for (const [id, record] of found) known.set(id, record)
		const next: WalkNode<GenericConfig>[] = []
		for (const record of found.values()) {
			if (isOmitted({ record, omitSpec })) continue
			const node: WalkNode<GenericConfig> = {
				record,
				scopeOf: [],
				parentId: parentOf.get(record.id),
			}
			nodes.set(record.id, node)
			if (follows(record.tagName)) next.push(node)
		}
		frontier = next
	}

	fillAnswers({ context, nodes, targets, omitSpec, answers })
}

/** Each kept record of a collected tag that matches a filter, into the answer of every scope above it. */
function fillAnswers<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	nodes: Map<string, WalkNode<GenericConfig>>
	targets: TargetsByTag
	omitSpec: OmitSpec
	answers: CollectedGroups<GenericConfig>[]
}): void {
	const { context, nodes, targets, omitSpec, answers } = params
	const scopesAbove = createScopesAbove({ nodes })
	const handedOut = new Set<string>()

	const sorted = [...nodes.values()].map(({ record }) => record).sort(compareById)
	for (const record of sorted) {
		const filters = targets.get(record.tagName)
		if (!filters || isOmitted({ record, omitSpec })) continue
		const matches = filters.some((where) =>
			matchesFlatTarget({ dialecteConfig: context.dialecteConfig, record, where }),
		)
		if (!matches) continue
		for (const position of scopesAbove(record.id)) {
			answers[position]
				.get(record.tagName)!
				.set(record.id, handedOut.has(record.id) ? { ...record } : record)
			handedOut.add(record.id)
		}
	}
}

/**
 * The input positions whose scope lies at or above a kept record, through the links the walk made: a scope's own
 * positions, then those of every scope above it. Memoised per record.
 */
function createScopesAbove<GenericConfig extends AnyDialecteConfig>(params: {
	nodes: Map<string, WalkNode<GenericConfig>>
}): (id: string) => number[] {
	const { nodes } = params
	const memo = new Map<string, number[]>()

	function scopesAbove(id: string): number[] {
		const known = memo.get(id)
		if (known) return known
		const node = nodes.get(id)
		if (!node) return []
		// set before the parent is asked, so a corrupt parent cycle answers what it has instead of looping
		const positions = [...node.scopeOf]
		memo.set(id, positions)
		if (node.parentId !== undefined) {
			for (const position of scopesAbove(node.parentId)) {
				if (!positions.includes(position)) positions.push(position)
			}
		}
		return positions
	}

	return scopesAbove
}

/** The flat targets by tag name, the unconditionally omitted tags left out. */
function targetsByTag(params: { targets: FlatTarget[]; omitSpec: OmitSpec }): TargetsByTag {
	const byTag: TargetsByTag = new Map()
	for (const { tagName, where } of params.targets) {
		if (params.omitSpec.unconditional.has(tagName)) continue
		const filters = byTag.get(tagName)
		if (filters) filters.push(where)
		else byTag.set(tagName, [where])
	}
	return byTag
}

/**
 * Whether the walk reads below a record of a tag: when its tag may hold a collected tag. A tag may hold one when
 * the definition does not know it, when it is transparent or holds xs:any content, or when its `descendants` hold
 * a collected tag or such an open tag. When a collected tag is itself unknown to the definition, every tag may.
 * Memoised per tag.
 */
function createFollowCheck(params: {
	dialecteConfig: AnyDialecteConfig
	collected: Set<string>
}): (tagName: string) => boolean {
	const { dialecteConfig, collected } = params
	const descendants = dialecteConfig.descendants as Record<string, readonly string[] | undefined>
	const transparent = new Set<string>(dialecteConfig.transparentElements ?? [])
	const followsEverything = [...collected].some((tagName) => descendants[tagName] === undefined)
	const memo = new Map<string, boolean>()

	function isOpen(tagName: string): boolean {
		return (
			descendants[tagName] === undefined ||
			transparent.has(tagName) ||
			dialecteConfig.definition[tagName]?.children.any === true
		)
	}

	return function follows(tagName: string): boolean {
		if (followsEverything) return true
		const known = memo.get(tagName)
		if (known !== undefined) return known
		const held = descendants[tagName]
		const answer =
			isOpen(tagName) ||
			(held ?? []).some((descendant) => collected.has(descendant) || isOpen(descendant))
		memo.set(tagName, answer)
		return answer
	}
}
