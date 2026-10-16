import { getRecord } from './get-record'
import { getLatestStagedRecord } from './staged-lookup'

import { invariant } from '@/utils'

import type { Context, RefOrRecord } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord } from '@/types'

/**
 * The record a read works on.
 *
 * A record given in full (one carrying its `attributes`) is read as it is, with no store round trip: a transaction's
 * staged operations still come first, so a record held from before a staged write reads as the transaction sees it
 * and one deleted in the transaction reads as absent. Outside a transaction the record is a snapshot - pass its ref
 * (`toRef(record)`) to read the store again. A ref, or a parent/child relationship, is fetched with {@link getRecord}.
 *
 * Perf: counts `core::query::getRecord.fromRecord` when the record given is the one read.
 *
 * @throws {@link DialecteError} when `ref` is undefined.
 */
export async function resolveRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	ref: RefOrRecord<GenericConfig, GenericElement> | undefined
}): Promise<TrackedRecord<GenericConfig, GenericElement> | undefined> {
	const { context, ref } = params
	invariant(ref, { detail: 'The record or ref is undefined' })
	if (!('attributes' in ref) || !Array.isArray(ref.attributes)) return getRecord({ context, ref })

	if (context.stagedOperations.log.length > 0) {
		const staged = getLatestStagedRecord<GenericConfig, GenericElement>({
			stagedOperations: context.stagedOperations,
			tagName: ref.tagName as GenericElement,
			id: ref.id,
		})
		if (staged?.status === 'deleted') return undefined
		if (staged) return staged
	}

	context.perf.count('core::query::getRecord.fromRecord')
	return ('status' in ref ? ref : { ...ref, status: 'unchanged' }) as TrackedRecord<
		GenericConfig,
		GenericElement
	>
}
