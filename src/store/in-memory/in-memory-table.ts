import type { AttributeLookup } from '../store.types'
import type { RecordTable, TagAttributeMap, TagIds } from './types'
import type { AnyRawRecord } from '@/types'

/**
 * An empty record table of a document: its records by id and the ids of each tag, both changed by `put` and `drop`
 * only, so a tag read walks that tag, never the whole document.
 */
export function createRecordTable(): RecordTable {
	const byId = new Map<string, AnyRawRecord>()
	const byTag = new Map<string, TagIds>()
	// the attribute pairs asked of each tag, dropped whole at any write of the tag
	const byAttribute = new Map<string, TagAttributeMap>()

	function leaveTag(params: { id: string; tagName: string }): void {
		const { id, tagName } = params
		const tag = byTag.get(tagName)
		if (!tag?.ids.delete(id)) return
		// a tag whose last id went keeps no entry: it reads as a tag never written
		if (tag.ids.size === 0) byTag.delete(tagName)
		else tag.sorted = undefined
	}

	function put(record: AnyRawRecord): void {
		const held = byId.get(record.id)
		byId.set(record.id, record)
		byAttribute.delete(record.tagName)
		if (held) byAttribute.delete(held.tagName)
		if (held?.tagName === record.tagName) return
		if (held) leaveTag({ id: held.id, tagName: held.tagName })
		const tag = byTag.get(record.tagName) ?? { ids: new Set<string>(), sorted: undefined }
		byTag.set(record.tagName, tag)
		tag.ids.add(record.id)
		tag.sorted = undefined
	}

	function drop(id: string): void {
		const held = byId.get(id)
		if (!held) return
		byId.delete(id)
		byAttribute.delete(held.tagName)
		leaveTag({ id, tagName: held.tagName })
	}

	function idsOfTag(tagName: string): readonly string[] {
		const tag = byTag.get(tagName)
		if (!tag) return []
		// the default sort compares strings by UTF-16 code unit: the id order of every list read (compareById)
		tag.sorted ??= [...tag.ids].sort()
		return tag.sorted
	}

	function idsOfAttributes(params: Omit<AttributeLookup, 'documentId'>): readonly string[] {
		const { tagName, attributes } = params
		const tag = byTag.get(tagName)
		if (!tag || attributes.length === 0) return []
		const tagMap: TagAttributeMap = byAttribute.get(tagName) ?? new Map()
		byAttribute.set(tagName, tagMap)
		const matched = attributes.map(function idsOfEntry({ name, values }) {
			// each pair built from the tag's records the first time it is asked, kept until the tag's next write
			const byValue = tagMap.get(name) ?? idsByValueOf({ ids: tag.ids, byId, name })
			tagMap.set(name, byValue)
			return new Set(values.flatMap((value) => [...(byValue.get(value) ?? [])]))
		})
		const [smallest, ...others] = [...matched].sort((left, right) => left.size - right.size)
		return [...smallest!].filter((id) => others.every((ids) => ids.has(id))).sort()
	}

	return {
		get: (id) => byId.get(id),
		has: (id) => byId.has(id),
		size: () => byId.size,
		records: () => byId.values(),
		idsOfTag,
		idsOfAttributes,
		put,
		drop,
	}
}

/** The ids among `ids` by value of their attributes of that name: every attribute of the name, a record once per value. */
function idsByValueOf(params: {
	ids: ReadonlySet<string>
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
