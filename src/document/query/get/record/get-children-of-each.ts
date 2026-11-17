import { getRecords } from './get-records'

import { toRef } from '@/helpers'

import type {
	ChildLink,
	ChildLookup,
	KnownRecords,
	ParentChildren,
} from './get-children-of-each.types'
import type { Context, Ref, RefOrRecord } from '@/document'
import type {
	AnyDialecteConfig,
	ChildrenOf,
	DialecteRecord,
	ElementsOf,
	TrackedRecord,
} from '@/types'

/**
 * The children of a given tag of each parent given, looked up through transparent elements as `getChildren` does.
 *
 * A record given is used as given: its `children` are followed and it is not read again. The refs are read together
 * in one `getRecords`. Then one `getRecords` reads the direct children of the tag of every parent, and the transparent
 * wrappers (`dialecteConfig.transparentElements`) of the parents that have none directly; one more reads the children
 * of the tag inside those wrappers. Staged operations and the transaction cache answer first, as `getRecords` resolves
 * them. A record already read in this call is not read again; a record answered at several positions is a shallow copy
 * at each one after the first.
 *
 * Returns one list per input position, in input order, each in the order of its parent's children; a parent that names
 * no element answers `[]`.
 *
 * Perf: at most three `core::store::getMany`, whatever the number of parents (none for the parents when every input
 * is a record, none for the wrappers' children when no parent needs them).
 *
 * @internal the context-level read behind `doc.query.getChildrenOfEach`; callers use the query
 */
export async function getChildrenOfEach<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
	tagName: GenericChildElement
}): Promise<TrackedRecord<GenericConfig, GenericChildElement>[][]> {
	const { context, refsOrRecords, tagName } = params
	const transparentElements: readonly string[] = context.dialecteConfig.transparentElements ?? []

	const { parents, read } = await readParents({ context, refsOrRecords })
	const lookups = parents.map((parent) => lookupOf({ parent, tagName, transparentElements }))
	const firstLinks = lookups.flatMap(({ direct, wrappers }) => [...direct, ...wrappers])
	const firstFound = await readMissing({ context, known: read, links: firstLinks })
	const firstKnown: KnownRecords<GenericConfig> = new Map([...read, ...firstFound])

	const childLinks = lookups.map(({ direct, wrappers }) =>
		direct.length > 0
			? direct
			: wrappers.flatMap((wrapper) =>
					childrenOfTag({ record: firstKnown.get(wrapper.id), tagName }),
				),
	)
	const secondFound = await readMissing({ context, known: firstKnown, links: childLinks.flat() })
	const known: KnownRecords<GenericConfig> = new Map([...firstKnown, ...secondFound])

	// the first position to answer a record takes the record read, every later one a copy of it
	const handedOut = new Set<string>()
	return childLinks.map((links) =>
		links.flatMap((link) => {
			const record = known.get(link.id)
			if (!record || record.tagName !== tagName) return []
			const answer = handedOut.has(record.id) ? { ...record } : record
			handedOut.add(record.id)
			return [answer as TrackedRecord<GenericConfig, GenericChildElement>]
		}),
	)
}

/**
 * The children a parent is answered from: its direct children of the tag, or, when it has none, its transparent
 * wrappers (looked into once read). A parent that names no element has neither.
 */
function lookupOf(params: {
	parent: ParentChildren | undefined
	tagName: string
	transparentElements: readonly string[]
}): ChildLookup {
	const { parent, tagName, transparentElements } = params
	if (!parent) return { direct: [], wrappers: [] }
	const direct = parent.children.filter((child) => child.tagName === tagName)
	if (direct.length > 0) return { direct, wrappers: [] }
	return {
		direct: [],
		wrappers: parent.children.filter((child) => transparentElements.includes(child.tagName)),
	}
}

/** The children of the tag a record names; none for a record not found. */
function childrenOfTag<GenericConfig extends AnyDialecteConfig>(params: {
	record: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
	tagName: string
}): ChildLink[] {
	const { record, tagName } = params
	return record ? record.children.filter((child) => child.tagName === tagName) : []
}

/**
 * Each input position's children refs: a record's own, a ref's read record's (all refs in one `getRecords`);
 * `undefined` for a ref that names no element. Also answers the records it read, by id.
 */
async function readParents<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
}): Promise<{
	parents: (ParentChildren | undefined)[]
	read: KnownRecords<GenericConfig>
}> {
	const { context, refsOrRecords } = params
	const parents: (ParentChildren | undefined)[] = refsOrRecords.map((refOrRecord) =>
		isRecordGiven(refOrRecord) ? { children: refOrRecord.children } : undefined,
	)
	const refPositions = [...refsOrRecords.keys()].filter(
		(position) => !isRecordGiven(refsOrRecords[position]),
	)
	const read: KnownRecords<GenericConfig> = new Map()
	if (refPositions.length === 0) return { parents, read }

	const records = await getRecords({
		context,
		refs: refPositions.map((position) => toRef(refsOrRecords[position])),
	})
	for (const [index, record] of records.entries()) {
		if (!record) continue
		parents[refPositions[index]] = { children: record.children }
		read.set(record.id, record)
	}
	return { parents, read }
}

/** Reads, in one `getRecords`, the links whose id `known` does not hold yet; answers the records found, by id. */
async function readMissing<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	known: KnownRecords<GenericConfig>
	links: ChildLink[]
}): Promise<KnownRecords<GenericConfig>> {
	const { context, known, links } = params
	const missing = new Map(
		links.filter((link) => !known.has(link.id)).map((link) => [link.id, link] as const),
	)
	if (missing.size === 0) return new Map()

	const refs = [...missing.values()] as Ref<GenericConfig, ElementsOf<GenericConfig>>[]
	const records = await getRecords({ context, refs })
	return new Map(records.flatMap((record) => (record ? [[record.id, record] as const] : [])))
}

/** Whether an input is a record rather than a ref or a relationship: only a record carries a `parent` (a relationship is a tag name and an id). */
function isRecordGiven<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	refOrRecord: RefOrRecord<GenericConfig, GenericElement>,
): refOrRecord is DialecteRecord<GenericConfig, GenericElement> {
	return 'parent' in refOrRecord
}
