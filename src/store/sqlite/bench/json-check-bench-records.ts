import { FIXTURE_ROOTS } from './bench.constants'
import {
	JSON_CHECK_BENCH_ATTRIBUTE_COUNTS,
	JSON_CHECK_BENCH_TEXT,
	JSON_CHECK_BENCH_TEXT_EVERY,
} from './json-check-bench.constants'

import type { AnyAttribute, AnyRawRecord, AnyRelationship } from '@/types'

/**
 * Records as an import hands them to the store, shaped like the composed 50 MB file's: a binary tree
 * (one child per record on average, each record's parent set), the attributes in turn from the
 * file's histogram, a text value on a quarter of them.
 */
export function fixtureShapedRecords(params: { count: number }): AnyRawRecord[] {
	const { count } = params
	const records: AnyRawRecord[] = []
	for (let index = 0; index < count; index++) {
		records.push({
			id: recordId({ index }),
			tagName: 'LNode',
			namespace: { prefix: '', uri: FIXTURE_ROOTS.composed.namespaceUri },
			attributes: attributesOf({ index }),
			value: index % JSON_CHECK_BENCH_TEXT_EVERY === 0 ? JSON_CHECK_BENCH_TEXT : '',
			parent: index === 0 ? null : { id: recordId({ index: (index - 1) >> 1 }), tagName: 'Bay' },
			children: childrenOf({ index, count }),
		})
	}
	return records
}

function recordId(params: { index: number }): string {
	return `record-${params.index}`
}

function attributesOf(params: { index: number }): AnyAttribute[] {
	const { index } = params
	const count =
		JSON_CHECK_BENCH_ATTRIBUTE_COUNTS[index % JSON_CHECK_BENCH_ATTRIBUTE_COUNTS.length] ?? 0
	const attributes: AnyAttribute[] = []
	for (let position = 0; position < count; position++) {
		attributes.push({ name: `attribute${position}`, value: `value-${index % 97}` })
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
