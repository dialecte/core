import { getRecords } from './get-records'
import { isRecordGiven } from './is-record-given'
import { readUnknownRecords } from './read-unknown-records'

import { throwDialecteError } from '@/errors'
import { toRef } from '@/helpers'

import type { ChildLookup, ParentChildren } from './get-children-of-each.types'
import type { KnownRecords, RecordLink } from './known-records.types'
import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf, TrackedRecord } from '@/types'

/**
 * The children of a given tag of each parent given, looked up through transparent elements as `getChildren` does.
 *
 * A record given is used as given: its `children` are followed and it is not read again. The refs are read together
 * in one `getRecords` (a ref without an id costs its own `getByTagName`, as in `getRecords`). Then one `getRecords`
 * reads the direct children of the tag of every parent, and the transparent wrappers
 * (`dialecteConfig.transparentElements`) of the parents that have none directly; one more reads the children of the
 * tag inside those wrappers, one level only. Staged operations and the transaction cache answer first, as
 * `getRecords` resolves them. A record already read in this call is not read again; a record answered at several
 * positions is a shallow copy at each one after the first.
 *
 * Returns one list per input position, in input order, each in the order of its parent's children; a parent that names
 * no element answers `[]`.
 *
 * Perf: at most three `core::store::getMany`, whatever the number of parents (none for the parents when every input
 * is a record, none for the wrappers' children when no parent needs them).
 *
 * @internal the context-level read behind `doc.query.getChildrenOfEach`; callers use the query
 *
 * @throws {@link DialecteError} `ELEMENT_TAGNAME_MISMATCH` when a parent names a child under another tag than its
 * record, as `getRecords` does.
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
	const firstFound = await readUnknownRecords({ context, known: read, links: firstLinks })
	const firstKnown: KnownRecords<GenericConfig> = new Map([...read, ...firstFound])

	const childLinks = lookups.map(({ direct, wrappers }) =>
		direct.length > 0
			? direct
			: wrappers.flatMap((wrapper) =>
					childrenOfTag({ record: knownRecordOf({ known: firstKnown, link: wrapper }), tagName }),
				),
	)
	const secondFound = await readUnknownRecords({
		context,
		known: firstKnown,
		links: childLinks.flat(),
	})
	const known: KnownRecords<GenericConfig> = new Map([...firstKnown, ...secondFound])

	// the first position to answer a record takes the record read, every later one a copy of it
	const handedOut = new Set<string>()
	return childLinks.map((links) =>
		links.flatMap((link) => {
			const record = knownRecordOf({ known, link })
			if (!record) return []
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
}): RecordLink[] {
	const { record, tagName } = params
	return record ? record.children.filter((child) => child.tagName === tagName) : []
}

/**
 * The record read for a link, `undefined` when none was found.
 *
 * @throws {@link DialecteError} `ELEMENT_TAGNAME_MISMATCH` when the link names another tag than the record read for
 * its id (a record read earlier in the call, which `getRecords` did not check against this link).
 */
function knownRecordOf<GenericConfig extends AnyDialecteConfig>(params: {
	known: KnownRecords<GenericConfig>
	link: RecordLink
}): TrackedRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined {
	const { known, link } = params
	const record = known.get(link.id)
	if (record && record.tagName !== link.tagName) {
		throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
			detail: `Expected tagName '${link.tagName}', got '${record.tagName}' for id '${link.id}'`,
			ref: link,
			meta: { id: link.id, expectedTagName: link.tagName, actualTagName: record.tagName },
		})
	}
	return record
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
	if (refPositions.length === 0) return { parents, read: new Map() }

	const records = await getRecords({
		context,
		refs: refPositions.map((position) => toRef(refsOrRecords[position])),
	})
	for (const [index, record] of records.entries()) {
		if (record) parents[refPositions[index]] = { children: record.children }
	}
	const read: KnownRecords<GenericConfig> = new Map(
		records.flatMap((record) => (record ? [[record.id, record] as const] : [])),
	)
	return { parents, read }
}
