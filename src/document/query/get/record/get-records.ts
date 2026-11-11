import { getRecord, trackStoredRecord } from './get-record'
import { getLatestStagedRecord } from './staged-lookup'

import { isTransactionContext } from '@/document'

import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord } from '@/types'

/**
 * Batch lookup: the records of several refs, in the order given; a missing record yields `undefined`.
 *
 * Each ref resolves as with `getRecord`: staged operations first, then the transaction cache, a ref
 * without id by its tag name. The refs left are read from the store in one `getMany` (each id once,
 * however often it is given), and a transaction caches every record it read. Positions naming the
 * same stored record get their own copy of it, sharing its nested arrays (as cache hits do).
 *
 * Perf: counts `core::store::getMany` once per call that reads the store by id, and
 * `core::query::getRecord.miss` once per id it reads.
 *
 * @internal the context-level read behind `doc.query.getRecords`; callers use the query
 *
 * @throws {@link DialecteError} `ELEMENT_TAGNAME_MISMATCH` when a ref names another tag than its
 * record: a staged or cached one before any store read, else the first in input order.
 */
export async function getRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refs: RefOrRecord<GenericConfig, GenericElement>[]
}): Promise<(TrackedRecord<GenericConfig, GenericElement> | undefined)[]> {
	const { context, refs } = params
	const results: (TrackedRecord<GenericConfig, GenericElement> | undefined)[] = refs.map(
		() => undefined,
	)
	const singletonPositions: number[] = []
	const storePositions: { position: number; id: string }[] = []

	// Synchronous pass first: a staged or cached mismatch throws before any read starts.
	for (const [position, ref] of refs.entries()) {
		if (ref.id === undefined) {
			singletonPositions.push(position)
			continue
		}
		const known = readKnown({ context, ref, id: ref.id })
		if (known) results[position] = known.record
		else storePositions.push({ position, id: ref.id })
	}

	const singletonReads = singletonPositions.map(function readSingleton(position) {
		return readSingletonInto({ context, refs, position, results })
	})
	await Promise.all([...singletonReads, readFromStore({ context, refs, storePositions, results })])
	return results
}

/** A ref without id, resolved by its tag name as `getRecord` does. */
async function readSingletonInto<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refs: RefOrRecord<GenericConfig, GenericElement>[]
	position: number
	results: (TrackedRecord<GenericConfig, GenericElement> | undefined)[]
}): Promise<void> {
	const { context, refs, position, results } = params
	const record = await getRecord({ context, ref: refs[position] })
	results[position] = record
}

/** A ref the staged operations or the transaction cache answer without a store read; `undefined` when neither does. */
function readKnown<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
	id: string
}): { record: TrackedRecord<GenericConfig, GenericElement> | undefined } | undefined {
	const { context, ref, id } = params
	if (context.stagedOperations.log.length > 0) {
		const staged = getLatestStagedRecord<GenericConfig, GenericElement>({
			stagedOperations: context.stagedOperations,
			tagName: ref.tagName as GenericElement,
			id,
		})
		if (staged) return { record: staged.status === 'deleted' ? undefined : staged }
	}
	const cached = isTransactionContext(context) ? context.recordCache.get(id) : undefined
	if (!cached) return undefined
	context.perf.count('core::query::getRecord.cacheHit')
	const raw = cached as RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	return { record: trackStoredRecord<GenericConfig, GenericElement>({ raw, ref }) }
}

/**
 * The positions left, read in one `getMany` (each id once). Every record read is cached first, then
 * each position is answered in input order, so a mismatch throws for the first one in that order.
 */
async function readFromStore<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refs: RefOrRecord<GenericConfig, GenericElement>[]
	storePositions: { position: number; id: string }[]
	results: (TrackedRecord<GenericConfig, GenericElement> | undefined)[]
}): Promise<void> {
	const { context, refs, storePositions, results } = params
	const ids = [...new Set(storePositions.map(({ id }) => id))]
	if (ids.length === 0) return

	context.perf.count('core::store::getMany')
	ids.forEach(function countMiss() {
		context.perf.count('core::query::getRecord.miss')
	})
	const raws = await context.store.getMany(ids, context.documentId)

	const rawById = new Map<string, RawRecord<GenericConfig, ElementsOf<GenericConfig>>>()
	for (const [index, id] of ids.entries()) {
		const raw = raws[index] as RawRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
		if (!raw) continue
		rawById.set(id, raw)
		if (isTransactionContext(context)) context.recordCache.set(id, raw)
	}

	for (const { position, id } of storePositions) {
		const raw = rawById.get(id)
		results[position] = raw
			? trackStoredRecord<GenericConfig, GenericElement>({ raw, ref: refs[position] })
			: undefined
	}
}
