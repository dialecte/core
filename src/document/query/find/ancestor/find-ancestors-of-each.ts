import { getRecords } from '../../get/record'
import { isRecordGiven } from '../../get/record/is-record-given'
import { readUnknownRecords } from '../../get/record/read-unknown-records'

import { toRef } from '@/helpers'

import type { KnownRecords } from '../../get/record/known-records.types'
import type { FindAncestorsOptions } from './find-ancestor.types'
import type { ParentLink, WalkStart } from './find-ancestors-of-each.types'
import type { Context, Ref, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * The ancestors of each element given, read one ancestor level at a time.
 *
 * A record given is used as given: its `parent` is followed and it is not read again. The refs are read
 * together in one `getRecords`. Then each level's parents not read yet in this call are read in one
 * `getRecords` (staged operations and the transaction cache first, as `getRecords` resolves them), until
 * every chain stops at its `depth`, at its `stopAtTagName` element (included) or at the root. The elements
 * `unwrap` lists (default: the dialecte's `transparentElements`) are walked through, left out of the chain: they
 * take no `depth` level and `stopAtTagName` never matches them; `unwrap: []` keeps every stored ancestor. A parent
 * cycle (a corrupt store) ends its walk once it has gone through as many records as were read. An ancestor
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
	const unwrapped = new Set<string>(
		options?.unwrap ?? context.dialecteConfig.transparentElements ?? [],
	)

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
	// the records each chain went through, the unwrapped ones included: the cycle guard counts them
	const steps = refsOrRecords.map(() => 0)
	while (frontier.length > 0) {
		const links = frontier.map(({ parent }) => parent)
		const found = await readUnknownRecords({ context, links, known })
		for (const [id, record] of found) known.set(id, record)
		const next: typeof frontier = []

		for (const { position, parent } of frontier) {
			const record = known.get(parent.id)
			// a walk goes through distinct records, all read in this call: one as long as what was read repeats one, a cycle
			if (!record || steps[position] >= known.size) continue
			steps[position] += 1
			// an unwrapped element is walked through: left out of the chain, it takes no depth level and never stops it
			if (unwrapped.has(record.tagName)) {
				if (record.parent) next.push({ position, parent: record.parent })
				continue
			}
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
