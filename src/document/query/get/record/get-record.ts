import { getLatestStagedRecord } from './staged-lookup'

import { isTransactionContext } from '@/document'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord, Ref } from '@/types'

/**
 * Fetch a single record by ref.
 *
 * Resolution order: staged operations → cache → store.
 * For singleton elements (id absent), resolves by tagName.
 * Always returns a TrackedRecord — 'unchanged' for clean store reads.
 *
 * Side effect: populates context.recordCache on store hits.
 */
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: Ref<GenericConfig, GenericElement>
}): Promise<TrackedRecord<GenericConfig, GenericElement> | undefined> {
	const { context, ref } = params
	// 1. Staged operations (highest priority)
	if (context.stagedOperations.length > 0) {
		const staged = getLatestStagedRecord<GenericConfig, GenericElement>({
			stagedOperations: context.stagedOperations,
			tagName: ref.tagName as GenericElement,
			id: ref.id,
		})
		if (staged?.status === 'deleted') return undefined
		if (staged) return staged
	}

	// 2. Cache (transaction-scoped) or store
	let raw: RawRecord<GenericConfig, GenericElement> | undefined

	if (ref.id === undefined) {
		// Singleton path — resolve by tagName
		const cacheKey = `__singleton_${ref.tagName}`
		const cached = isTransactionContext(context) ? context.recordCache.get(cacheKey) : undefined
		if (cached) {
			raw = cached as RawRecord<GenericConfig, GenericElement>
		} else {
			const records = (await context.store.getByTagName(ref.tagName)) as RawRecord<
				GenericConfig,
				GenericElement
			>[]
			raw = records[0]
			if (raw && isTransactionContext(context)) {
				context.recordCache.set(raw.id, raw)
				context.recordCache.set(cacheKey, raw)
			}
		}
	} else {
		// Normal path — resolve by id
		const cached = isTransactionContext(context) ? context.recordCache.get(ref.id) : undefined
		if (cached) {
			raw = cached as RawRecord<GenericConfig, GenericElement>
		} else {
			raw = (await context.store.get(ref.id)) as
				| RawRecord<GenericConfig, GenericElement>
				| undefined
			if (raw && isTransactionContext(context)) context.recordCache.set(ref.id, raw)
		}
	}

	if (!raw) return undefined
	return { ...raw, status: 'unchanged' } as TrackedRecord<GenericConfig, GenericElement>
}
