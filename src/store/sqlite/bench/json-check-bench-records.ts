import { FIXTURE_ROOTS } from './bench.constants'
import {
	JSON_CHECK_BENCH_ATTRIBUTE_COUNTS,
	JSON_CHECK_BENCH_TEXT,
	JSON_CHECK_BENCH_TEXT_EVERY,
	JSON_CHECK_BENCH_TWO_BYTE_MARK,
} from './json-check-bench.constants'

import type { JsonCheckStrings } from './json-check-bench.types'
import type { AnyAttribute, AnyRawRecord, AnyRelationship } from '@/types'

/**
 * Records as an import hands them to the store, shaped like the composed 50 MB file's: a binary tree
 * (one child per record on average, each record's parent set), the attributes in turn from the
 * file's histogram, a text value on a quarter of them. `two-byte` strings: every attribute value and
 * text value holds one character beyond Latin-1.
 */
export function fixtureShapedRecords(params: {
	count: number
	strings: JsonCheckStrings
}): AnyRawRecord[] {
	const { count, strings } = params
	const mark = strings === 'two-byte' ? JSON_CHECK_BENCH_TWO_BYTE_MARK : ''
	const records: AnyRawRecord[] = []
	for (let index = 0; index < count; index++) {
		records.push({
			id: recordId({ index }),
			tagName: 'LNode',
			namespace: { prefix: '', uri: FIXTURE_ROOTS.composed.namespaceUri },
			attributes: attributesOf({ index, mark }),
			value: index % JSON_CHECK_BENCH_TEXT_EVERY === 0 ? `${JSON_CHECK_BENCH_TEXT}${mark}` : '',
			parent: index === 0 ? null : { id: recordId({ index: (index - 1) >> 1 }), tagName: 'Bay' },
			children: childrenOf({ index, count }),
		})
	}
	return records
}

function recordId(params: { index: number }): string {
	return `record-${params.index}`
}

function attributesOf(params: { index: number; mark: string }): AnyAttribute[] {
	const { index, mark } = params
	const count =
		JSON_CHECK_BENCH_ATTRIBUTE_COUNTS[index % JSON_CHECK_BENCH_ATTRIBUTE_COUNTS.length] ?? 0
	const attributes: AnyAttribute[] = []
	for (let position = 0; position < count; position++) {
		attributes.push({ name: `attribute${position}`, value: `value-${index % 97}${mark}` })
	}
	return attributes
}

function childrenOf(params: { index: number; count: number }): AnyRelationship[] {
	const { index, count } = params
	const children: AnyRelationship[] = []
	for (const child of [2 * index + 1, 2 * index + 2]) {
		if (child < count) children.push({ id: recordId({ index: child }), tagName: 'LNode' })
	}
	return children
}
