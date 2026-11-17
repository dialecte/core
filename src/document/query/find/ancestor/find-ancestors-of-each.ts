import { getRecords } from '../../get/record'

import { toRef } from '@/helpers'

import type { FindAncestorsOptions } from './find-ancestor.types'
import type { KnownRecords, ParentLink, WalkStart } from './find-ancestors-of-each.types'
import type { Context, Ref, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, DialecteRecord, ElementsOf, TrackedRecord } from '@/types'

/**
 * The ancestors of each element given, read one ancestor level at a time.
 *
 * A record given is used as given: its `parent` is followed and it is not read again. The refs are read
 * together in one `getRecords`. Then each level's parents not read yet in this call are read in one
 * `getRecords` (staged operations and the transaction cache first, as `getRecords` resolves them), until
 * every chain stops at its `depth`, at its `stopAtTagName` element (included) or at the root. A parent
 * cycle (a corrupt store) ends its chain once the chain is as long as the records read. An ancestor
 * shared by several elements is read once; each position gets its own shallow copy of it.
 *
 * Returns one list per input position, in input order, bottom-up unless `order: 'top-down'`; a ref that
 * names no element answers `[]`.
 *
 * Perf: one `core::store::getMany` for the refs (none when every input is a record), then at most one per
 * ancestor level.
 *
 * @internal the context-level read behind `doc.query.findAncestorsOfEach`; callers use the query
 */
export async function findAncestorsOfEach<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
	options?: FindAncestorsOptions<GenericConfig>
}): Promise<TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[][]> {
	const { context, refsOrRecords, options } = params
	const maxDepth = options?.depth ?? Infinity
	const stopAtTagName = options?.stopAtTagName

	const chains: TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>[][] = refsOrRecords.map(
		() => [],
	)
	const { starts, read } = await readStarts({ context, refsOrRecords })
	const known: KnownRecords<GenericConfig> = new Map(read)

	let frontier: { position: number; parent: ParentLink<GenericConfig> }[] = []
	if (maxDepth > 0) {
		for (const [position, start] of starts.entries()) {
			if (start?.parent) frontier.push({ position, parent: start.parent })
		}
	}

	// the first chain to reach an ancestor takes the record read, every later one a copy of it
	const handedOut = new Set<string>()
	while (frontier.length > 0) {
		const links = frontier.map(({ parent }) => parent)
		const found = await readUnknown({ context, links, known })
		for (const [id, record] of found) known.set(id, record)
		const next: typeof frontier = []

		for (const { position, parent } of frontier) {
			const record = known.get(parent.id)
			// a chain holds distinct records, all read in this call: one as long as what was read repeats one, a parent cycle
			if (!record || chains[position].length >= known.size) continue
			chains[position].push(handedOut.has(record.id) ? { ...record } : record)
			handedOut.add(record.id)

			const stops =
				chains[position].length >= maxDepth ||
				(stopAtTagName !== undefined && record.tagName === stopAtTagName)
			if (!stops && record.parent) next.push({ position, parent: record.parent })
		}
		frontier = next
	}

	return options?.order === 'top-down' ? chains.map((chain) => [...chain].reverse()) : chains
}

/**
 * Where each input position's walk starts: a record's own `parent`, a ref's read record's `parent` (all refs
 * in one `getRecords`); `undefined` for a ref that names no element. Also answers the records it read, by id.
 */
async function readStarts<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refsOrRecords: ReadonlyArray<RefOrRecord<GenericConfig, GenericElement>>
}): Promise<{
	starts: (WalkStart<GenericConfig> | undefined)[]
	read: KnownRecords<GenericConfig>
}> {
	const { context, refsOrRecords } = params
	const read: KnownRecords<GenericConfig> = new Map()
	const starts: (WalkStart<GenericConfig> | undefined)[] = refsOrRecords.map(() => undefined)
	const refPositions: number[] = []
	const refs: Ref<GenericConfig, GenericElement>[] = []

	for (const [position, refOrRecord] of refsOrRecords.entries()) {
		if (isRecordGiven(refOrRecord)) {
			starts[position] = { parent: refOrRecord.parent }
			continue
		}
		refPositions.push(position)
		refs.push(toRef(refOrRecord))
	}
	if (refs.length === 0) return { starts, read }

	const records = await getRecords({ context, refs })
	for (const [index, record] of records.entries()) {
		if (!record) continue
		starts[refPositions[index]] = { parent: record.parent }
		read.set(record.id, record)
	}
	return { starts, read }
}

/** Reads, in one `getRecords`, the links whose id `known` does not hold yet; answers the records found, by id. */
async function readUnknown<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	links: ParentLink<GenericConfig>[]
	known: KnownRecords<GenericConfig>
}): Promise<KnownRecords<GenericConfig>> {
	const { context, links, known } = params
	const found: KnownRecords<GenericConfig> = new Map()
	const unknownById = new Map<string, ParentLink<GenericConfig>>()
	for (const link of links) {
		if (!known.has(link.id)) unknownById.set(link.id, link)
	}
	if (unknownById.size === 0) return found

	const refs = [...unknownById.values()] as Ref<GenericConfig, ElementsOf<GenericConfig>>[]
	const records = await getRecords({ context, refs })
	for (const record of records) {
		if (record) found.set(record.id, record)
	}
	return found
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
