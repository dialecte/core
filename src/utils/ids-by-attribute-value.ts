import { idsInEvery } from './ids-in-every'

import type { AttributeLookup } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'

/**
 * The ids among `ids` by value of their attributes of that name: every attribute of the name, a record once per value.
 *
 * @internal one attribute's value index, built from records held: the in-memory store's and a transaction's read cache
 */
export function idsByValueOf(params: {
	ids: Iterable<string>
	byId: ReadonlyMap<string, AnyRawRecord>
	name: string
}): Map<string, Set<string>> {
	const { ids, byId, name } = params
	const byValue = new Map<string, Set<string>>()
	for (const id of ids) {
		for (const attribute of byId.get(id)?.attributes ?? []) {
			if (attribute.name !== name) continue
			const holders = byValue.get(attribute.value) ?? new Set<string>()
			byValue.set(attribute.value, holders)
			holders.add(id)
		}
	}
	return byValue
}

/**
 * The ids an attribute lookup answers, from each entry's value index (`byValueOf`): holding, for every entry, one of its
 * values (AND of the entries, OR of the values), in id order (strings by UTF-16 code unit, as `compareById`). No entry
 * answers nothing.
 *
 * @internal the attribute lookup rule of the in-memory store and of a transaction's read cache
 */
export function idsOfLookup(params: {
	attributes: AttributeLookup['attributes']
	byValueOf: (name: string) => ReadonlyMap<string, ReadonlySet<string>>
}): string[] {
	const { attributes, byValueOf } = params
	if (attributes.length === 0) return []
	const matched = attributes.map(function idsOfEntry({ name, values }) {
		const byValue = byValueOf(name)
		return new Set(values.flatMap((value) => [...(byValue.get(value) ?? [])]))
	})
	return idsInEvery(matched).sort()
}
