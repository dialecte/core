import { getRecords } from './get-records'

import type { KnownRecords, RecordLink } from './known-records.types'
import type { Context, Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * Reads, in one `getRecords`, the links whose id `known` does not hold yet (each id once); answers the
 * records found, by id. No read when every link is known.
 *
 * @internal shared by the batch reads (`getChildrenOfEach`, `findAncestorsOfEach`)
 */
export async function readUnknownRecords<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	links: ReadonlyArray<RecordLink>
	known: KnownRecords<GenericConfig>
}): Promise<KnownRecords<GenericConfig>> {
	const { context, links, known } = params
	const unknownById = new Map(
		links.filter((link) => !known.has(link.id)).map((link) => [link.id, link] as const),
	)
	if (unknownById.size === 0) return new Map()

	const refs = [...unknownById.values()] as Ref<GenericConfig, ElementsOf<GenericConfig>>[]
	const records = await getRecords({ context, refs })
	return new Map(records.flatMap((record) => (record ? [[record.id, record] as const] : [])))
}
