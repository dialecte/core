import { createRecordTable } from './in-memory-table'

import { expect } from 'vitest'

import { runTestCases } from '@/test'

import type { RecordTable } from './types'
import type { BaseTestCase } from '@/test'
import type { AnyRawRecord } from '@/types'

/** One write of the table, or a tag read (it sorts and keeps that tag's ids until its next write). */
type TableStep = { put: [id: string, tagName: string] } | { drop: string } | { read: string }

type TestCase = BaseTestCase & {
	steps: TableStep[]
	expected: { tags: Record<string, string[]>; size: number }
}

function recordOf(params: { id: string; tagName: string }): AnyRawRecord {
	const { id, tagName } = params
	return {
		id,
		tagName,
		namespace: { prefix: '', uri: '' },
		attributes: [],
		value: '',
		parent: null,
		children: [],
	}
}

function applyStep(params: { table: RecordTable; step: TableStep }): void {
	const { table, step } = params
	if ('put' in step) table.put(recordOf({ id: step.put[0], tagName: step.put[1] }))
	else if ('drop' in step) table.drop(step.drop)
	else table.idsOfTag(step.read)
}

const testCases: Record<string, TestCase> = {
	'puts of A out of id order -> A in id order': {
		steps: [{ put: ['z', 'A'] }, { put: ['b', 'A'] }, { put: ['m', 'A'] }, { put: ['a', 'B'] }],
		expected: { tags: { A: ['b', 'm', 'z'], B: ['a'] }, size: 4 },
	},
	'ids compared by UTF-16 code unit, not by locale nor code point -> that order': {
		steps: [
			{ put: ['～', 'A'] },
			{ put: ['😀', 'A'] },
			{ put: ['é', 'A'] },
			{ put: ['a', 'A'] },
			{ put: ['Z', 'A'] },
			{ put: ['B', 'A'] },
		],
		expected: { tags: { A: ['B', 'Z', 'a', 'é', '😀', '～'] }, size: 6 },
	},
	'A read, then a put of A -> the new id in A, in id order': {
		steps: [{ put: ['c', 'A'] }, { read: 'A' }, { put: ['a', 'A'] }],
		expected: { tags: { A: ['a', 'c'] }, size: 2 },
	},
	'A read, then a drop of A -> the dropped id gone from A': {
		steps: [{ put: ['a', 'A'] }, { put: ['b', 'A'] }, { read: 'A' }, { drop: 'a' }],
		expected: { tags: { A: ['b'] }, size: 1 },
	},
	'a put of a held id under B, both tags read before -> out of A, in B': {
		steps: [
			{ put: ['a', 'A'] },
			{ put: ['b', 'A'] },
			{ put: ['c', 'B'] },
			{ read: 'A' },
			{ read: 'B' },
			{ put: ['a', 'B'] },
		],
		expected: { tags: { A: ['b'], B: ['a', 'c'] }, size: 3 },
	},
	'a put of a held id under its own tag -> listed once': {
		steps: [{ put: ['a', 'A'] }, { read: 'A' }, { put: ['a', 'A'] }],
		expected: { tags: { A: ['a'] }, size: 1 },
	},
	'the last id of A dropped -> A empty, B kept': {
		steps: [{ put: ['a', 'A'] }, { put: ['b', 'B'] }, { read: 'A' }, { drop: 'a' }],
		expected: { tags: { A: [], B: ['b'] }, size: 1 },
	},
	'a drop of an id not held -> nothing changes': {
		steps: [{ put: ['a', 'A'] }, { read: 'A' }, { drop: 'nope' }],
		expected: { tags: { A: ['a'] }, size: 1 },
	},
	'a tag never put -> no ids': {
		steps: [{ put: ['a', 'A'] }],
		expected: { tags: { C: [] }, size: 1 },
	},
}

runTestCases.generic(testCases, (testCase) => {
	const table = createRecordTable()
	for (const step of testCase.steps) applyStep({ table, step })

	const tags = Object.fromEntries(
		Object.keys(testCase.expected.tags).map((tagName) => [tagName, [...table.idsOfTag(tagName)]]),
	)
	expect({ tags, size: table.size() }).toEqual(testCase.expected)
})
