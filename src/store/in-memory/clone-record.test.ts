import { cloneRecord } from './clone-record'

import { expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyRawRecord } from '@/types'

type TestCase = BaseTestCase & { record: Partial<AnyRawRecord> }

const RECORD: AnyRawRecord = {
	id: 'r1',
	tagName: 'A',
	namespace: { prefix: 'p', uri: 'urn:p' },
	attributes: [{ name: 'aA', value: '1' }],
	value: 'v',
	parent: { id: 'r0', tagName: 'Root' },
	children: [
		{ id: 'r2', tagName: 'B' },
		{ id: 'r3', tagName: 'C' },
	],
}

/** Every object and array a value holds, itself included. */
function objectsOf(params: { value: unknown }): unknown[] {
	const { value } = params
	if (value === null || typeof value !== 'object') return []
	const nested = Object.values(value).flatMap((field) => objectsOf({ value: field }))
	return [value, ...nested]
}

const testCases: Record<string, TestCase> = {
	'a record with a parent, attributes and children -> equal, nothing shared': {
		record: {},
	},
	'a qualified attribute -> its namespace copied too': {
		record: {
			attributes: [
				{ name: 'aA', value: '1', namespace: { prefix: 'q', uri: 'urn:q' } },
				{ name: 'bA', value: '2' },
			],
		},
	},
	'a root, no attribute nor child -> parent null, empty lists copied': {
		record: { parent: null, attributes: [], children: [] },
	},
	'an attribute and a child carrying more JSON than their type -> copied whole': {
		record: {
			attributes: [{ name: 'aA', value: '1', extra: { deep: [1, { two: 2 }] } } as never],
			children: [{ id: 'r2', tagName: 'B', extra: ['x', { y: null }] } as never],
		},
	},
}

runTestCases.generic(testCases, (testCase) => {
	const record: AnyRawRecord = { ...RECORD, ...testCase.record }
	const asGiven = structuredClone(record)

	const copy = cloneRecord({ record })

	expect(copy).toEqual(asGiven)
	const held = new Set(objectsOf({ value: record }))
	const shared = objectsOf({ value: copy }).filter((object) => held.has(object))
	expect(shared, 'objects the copy shares with the record').toEqual([])
})
