import { storedRecordOf } from './stored-record'

import type { AnyRawRecord, RecordPatch } from '@/types'

/**
 * A record with a bulk-write patch applied, the record given left unchanged: each field the patch
 * gives replaces the record's (a field given as `undefined` is not given); attributes merge by name
 * (a held one replaced in place, a new one appended), then `removeAttributes` drops the names
 * listed; children merge by id the same way. A field the record type does not have is dropped, as a
 * store keeps it. Every store applies a patch through this.
 */
export function applyRecordPatch(params: {
	record: AnyRawRecord
	patch: RecordPatch
}): AnyRawRecord {
	const { record, patch } = params
	const { recordId: _recordId, attributes, children, removeAttributes, ...fields } = patch
	const patched: AnyRawRecord = { ...record }

	for (const [field, value] of Object.entries(fields)) {
		if (value !== undefined) Object.assign(patched, { [field]: value })
	}

	if (attributes) {
		patched.attributes = mergeByKey({ held: record.attributes, given: attributes, key: 'name' })
	}
	if (removeAttributes?.length) {
		patched.attributes = patched.attributes.filter(
			(attribute) => !removeAttributes.includes(attribute.name),
		)
	}
	if (children) {
		patched.children = mergeByKey({ held: record.children, given: children, key: 'id' })
	}

	return storedRecordOf({ record: patched })
}

/** The held items with each given one replacing the held one of the same key, new ones appended. */
function mergeByKey<GenericItem, GenericKey extends keyof GenericItem>(params: {
	held: GenericItem[]
	given: GenericItem[]
	key: GenericKey
}): GenericItem[] {
	const { held, given, key } = params
	const merged = [...held]
	for (const item of given) {
		const index = merged.findIndex((existing) => existing[key] === item[key])
		if (index >= 0) merged[index] = item
		else merged.push(item)
	}
	return merged
}
