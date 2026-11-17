import { stagedIdsMatching } from './staged-attribute-index'
import { createStagedOperations, recordStagedOperation } from './staged-operations'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { AttributeLookup } from '@/store'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord, Operation } from '@/types'

/** A staged write as a case lists it: a create or a delete of a record, an update to that record. */
type Write = {
	status: 'created' | 'updated' | 'deleted'
	id: string
	aA?: string
	tagName?: string
}

type TestCase = BaseTestCase & {
	writes: Write[]
	lookup: AttributeLookup['attributes']
	tagName?: string
	/** The ids the staged index answers, sorted. */
	expectedIds: string[]
	/** The ids holding a place after the stored records, in place order. */
	expectedAppended: string[]
}

function recordOf(write: Write): AnyRawRecord {
	return {
		id: write.id,
		tagName: write.tagName ?? 'A',
		namespace: { prefix: '', uri: '' },
		attributes: write.aA === undefined ? [] : [{ name: 'aA', value: write.aA }],
		value: '',
		parent: null,
		children: [],
	}
}

function operationOf(write: Write): Operation<AnyDialecteConfig> {
	const record = recordOf(write)
	if (write.status === 'created')
		return { status: 'created', oldRecord: undefined, newRecord: record }
	if (write.status === 'deleted')
		return { status: 'deleted', oldRecord: record, newRecord: undefined }
	return { status: 'updated', oldRecord: record, newRecord: record }
}

describe('recordStagedOperation and stagedIdsMatching', () => {
	const testCases: Record<string, TestCase> = {
		'creates → each indexed by its value, placed in staging order': {
			writes: [
				{ status: 'created', id: 'b', aA: 'v' },
				{ status: 'created', id: 'a', aA: 'w' },
				{ status: 'created', id: 'c', aA: 'v' },
			],
			lookup: [{ name: 'aA', values: ['v'] }],
			expectedIds: ['b', 'c'],
			expectedAppended: ['b', 'a', 'c'],
		},
		'a create then an update to another value → found by the new value only, its place kept': {
			writes: [
				{ status: 'created', id: 'b', aA: 'w' },
				{ status: 'created', id: 'a', aA: 'v' },
				{ status: 'updated', id: 'b', aA: 'v' },
			],
			lookup: [{ name: 'aA', values: ['w'] }],
			expectedIds: [],
			expectedAppended: ['b', 'a'],
		},
		'an update of a stored record → indexed, no place': {
			writes: [{ status: 'updated', id: 'm', aA: 'v' }],
			lookup: [{ name: 'aA', values: ['v'] }],
			expectedIds: ['m'],
			expectedAppended: [],
		},
		'an update then a delete → no entry, no place': {
			writes: [
				{ status: 'created', id: 'b', aA: 'v' },
				{ status: 'updated', id: 'b', aA: 'v' },
				{ status: 'deleted', id: 'b', aA: 'v' },
			],
			lookup: [{ name: 'aA', values: ['v'] }],
			expectedIds: [],
			expectedAppended: [],
		},
		'a stored record deleted then created again → indexed, placed after the later creates': {
			writes: [
				{ status: 'created', id: 'a', aA: 'v' },
				{ status: 'deleted', id: 'c', aA: 'v' },
				{ status: 'created', id: 'z', aA: 'v' },
				{ status: 'created', id: 'c', aA: 'v' },
			],
			lookup: [{ name: 'aA', values: ['v'] }],
			expectedIds: ['a', 'c', 'z'],
			expectedAppended: ['a', 'z', 'c'],
		},
		'a list of values and another tag → any of the values, of the tag asked only': {
			writes: [
				{ status: 'created', id: 'a', aA: '1' },
				{ status: 'created', id: 'b', aA: '2' },
				{ status: 'created', id: 'c', aA: '3' },
				{ status: 'created', id: 'd', aA: '1', tagName: 'B' },
			],
			lookup: [{ name: 'aA', values: ['1', '2'] }],
			expectedIds: ['a', 'b'],
			expectedAppended: ['a', 'b', 'c', 'd'],
		},
		'two entries → the ids matching both': {
			writes: [
				{ status: 'created', id: 'a', aA: '1' },
				{ status: 'created', id: 'b', aA: '2' },
			],
			lookup: [
				{ name: 'aA', values: ['1', '2'] },
				{ name: 'aA', values: ['2'] },
			],
			expectedIds: ['b'],
			expectedAppended: ['a', 'b'],
		},
		'a lookup of the other tag → its record only': {
			writes: [
				{ status: 'created', id: 'a', aA: '1' },
				{ status: 'created', id: 'd', aA: '1', tagName: 'B' },
			],
			lookup: [{ name: 'aA', values: ['1'] }],
			tagName: 'B',
			expectedIds: ['d'],
			expectedAppended: ['a', 'd'],
		},
	}

	/** The writes staged in order, then what the staged index answers and where each id is placed. */
	function stagedAnswerOf(testCase: TestCase): {
		ids: string[]
		appended: string[]
		logged: number
	} {
		const stagedOperations = createStagedOperations<AnyDialecteConfig>()
		for (const write of testCase.writes) {
			recordStagedOperation({ stagedOperations, operation: operationOf(write) })
		}
		const ids = stagedIdsMatching({
			stagedOperations,
			tagName: testCase.tagName ?? 'A',
			attributes: testCase.lookup,
		})
		const appended = [...stagedOperations.appended.entries()]
			.sort(([, left], [, right]) => left - right)
			.map(([id]) => id)
		return { ids: [...ids].sort(), appended, logged: stagedOperations.log.length }
	}

	function act(testCase: TestCase): void {
		expect(stagedAnswerOf(testCase)).toEqual({
			ids: testCase.expectedIds,
			appended: testCase.expectedAppended,
			logged: testCase.writes.length,
		})
	}

	runTestCases.generic(testCases, act)
})
