import { getLatestStagedRecord } from './staged-lookup'

import { isTransactionContext } from '@/document'
import { throwDialecteError } from '@/errors'

import type { Context } from '@/document'
import type { RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord } from '@/types'

/**
 * Fetch a single record by ref.
 *
 * Resolution order: staged operations → cache → store.
 * For singleton elements (id absent), resolves by tagName.
 * Always returns a TrackedRecord — 'unchanged' for clean store reads.
 *
 * Side effect: populates context.recordCache on store hits.
 *
 * @throws {@link DialecteError} `ELEMENT_TAGNAME_MISMATCH` when a record is found by id
 * but its tagName differs from `ref.tagName` (mirrors the staged-lookup path).
 */
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement>
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
			const records = (await context.store.getByTagNameInDocument(
				ref.tagName,
				context.documentId,
			)) as RawRecord<GenericConfig, GenericElement>[]
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
			raw = (await context.store.get(ref.id, context.documentId)) as
				| RawRecord<GenericConfig, GenericElement>
				| undefined
			if (raw && isTransactionContext(context)) context.recordCache.set(ref.id, raw)
		}
	}

	if (!raw) return undefined

	if (raw.tagName !== ref.tagName) {
		throwDialecteError('ELEMENT_TAGNAME_MISMATCH', {
			detail: `Expected tagName '${ref.tagName}', got '${raw.tagName}' for id '${ref.id}'`,
			ref,
		})
	}

	return { ...raw, status: 'unchanged' } as TrackedRecord<GenericConfig, GenericElement>
}
