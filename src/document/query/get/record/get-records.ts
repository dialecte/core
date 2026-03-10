import { getRecord } from './get-record'

import type { Context } from '@/document'
import type { AnyDialecteConfig, ElementsOf, TrackedRecord, Ref } from '@/types'

/**
 * Batch lookup — resolve multiple refs in parallel.
 * Delegates to getRecord per ref; cache hits avoid redundant store calls.
 */
export async function getRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	context: Context<GenericConfig>
	refs: Ref<GenericConfig, GenericElement>[]
}): Promise<(TrackedRecord<GenericConfig, GenericElement> | undefined)[]> {
	const { context, refs } = params
	return Promise.all(refs.map((ref) => getRecord({ context, ref })))
}
