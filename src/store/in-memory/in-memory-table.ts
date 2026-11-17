import type { RecordTable, TagIds } from './types'
import type { AnyRawRecord } from '@/types'

/**
 * An empty record table of a document: its records by id and the ids of each tag, both changed by `put` and `drop`
 * only, so a tag read walks that tag, never the whole document.
 */
export function createRecordTable(): RecordTable {
	const byId = new Map<string, AnyRawRecord>()
	const byTag = new Map<string, TagIds>()

	function leaveTag(params: { id: string; tagName: string }): void {
		const { id, tagName } = params
		const tag = byTag.get(tagName)
		if (!tag?.ids.delete(id)) return
		tag.sorted = undefined
	}

	function put(record: AnyRawRecord): void {
		const held = byId.get(record.id)
		byId.set(record.id, record)
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
		leaveTag({ id, tagName: held.tagName })
	}

	function idsOfTag(tagName: string): readonly string[] {
		const tag = byTag.get(tagName)
		if (!tag) return []
		// the default sort compares strings by UTF-16 code unit: the id order of every list read (compareById)
		tag.sorted ??= [...tag.ids].sort()
		return tag.sorted
	}

	return {
		get: (id) => byId.get(id),
		has: (id) => byId.has(id),
		size: () => byId.size,
		records: () => byId.values(),
		idsOfTag,
		put,
		drop,
	}
}
