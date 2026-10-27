import { toJsonCopy } from './json-values'

import type { AnyRawRecord } from '@/types'

/**
 * A record as every store keeps it: the fields of the record type - its id, tag name, namespace (prefix
 * and uri), attributes, value, parent (id and tag name, or none) and children - and nothing else the
 * object carries, at its top, in its namespace or in its parent (attributes and children are kept as
 * given). A store checks the whole record as JSON first, so a value that is not JSON is refused even
 * in a field it then drops.
 */
export function storedRecordOf(params: { record: AnyRawRecord }): AnyRawRecord {
	const { record } = params
	const { id, tagName, namespace, attributes, value, parent, children } = record
	return {
		id,
		tagName,
		namespace: { prefix: namespace.prefix, uri: namespace.uri },
		attributes,
		value,
		parent: parent === null ? null : { id: parent.id, tagName: parent.tagName },
		children,
	}
}

/** A store's own copies of records a write hands it: checked whole as JSON values, kept as the record type has them. */
export function toStoredRecords(params: { records: AnyRawRecord[] }): AnyRawRecord[] {
	return toJsonCopy({ value: params.records }).map((record) => storedRecordOf({ record }))
}
