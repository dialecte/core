import { applyRecordPatch } from './apply-record-patch'

import { expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyRawRecord, RecordPatch } from '@/types'

type TestCase = BaseTestCase & {
	record: Partial<AnyRawRecord>
	patch: Omit<RecordPatch, 'recordId'>
	expected: Partial<AnyRawRecord>
}

const RECORD: AnyRawRecord = {
	id: 'r1',
	tagName: 'A',
	namespace: { prefix: '', uri: '' },
	attributes: [],
	value: '',
	parent: null,
	children: [],
}

const testCases: Record<string, TestCase> = {
	'patch sets aA held -> replaced in place, order kept': {
		record: {
			attributes: [
				{ name: 'aA', value: 'a' },
				{ name: 'bA', value: 'b' },
			],
		},
		patch: { attributes: [{ name: 'aA', value: 'A' }] },
		expected: {
			attributes: [
				{ name: 'aA', value: 'A' },
				{ name: 'bA', value: 'b' },
			],
		},
	},
	'patch sets cA not held -> appended': {
		record: { attributes: [{ name: 'aA', value: 'a' }] },
		patch: { attributes: [{ name: 'cA', value: 'c' }] },
		expected: {
			attributes: [
				{ name: 'aA', value: 'a' },
				{ name: 'cA', value: 'c' },
			],
		},
	},
	'patch sets and removes aA -> aA gone, removal after the merge': {
		record: { attributes: [{ name: 'aA', value: 'a' }] },
		patch: { attributes: [{ name: 'aA', value: 'A' }], removeAttributes: ['aA'] },
		expected: { attributes: [] },
	},
	'patch removes aA with attributes given as undefined -> aA gone, bA kept': {
		record: {
			attributes: [
				{ name: 'aA', value: 'a' },
				{ name: 'bA', value: 'b' },
			],
		},
		patch: { attributes: undefined, removeAttributes: ['aA'] },
		expected: { attributes: [{ name: 'bA', value: 'b' }] },
	},
	'patch removes an attribute not held -> attributes unchanged': {
		record: { attributes: [{ name: 'bA', value: 'b' }] },
		patch: { removeAttributes: ['aA'] },
		expected: { attributes: [{ name: 'bA', value: 'b' }] },
	},
	'patch lists child c1 held and c3 new -> c1 replaced in place, c3 appended': {
		record: {
			children: [
				{ id: 'c1', tagName: 'B' },
				{ id: 'c2', tagName: 'B' },
			],
		},
		patch: {
			children: [
				{ id: 'c3', tagName: 'B' },
				{ id: 'c1', tagName: 'C' },
			],
		},
		expected: {
			children: [
				{ id: 'c1', tagName: 'C' },
				{ id: 'c2', tagName: 'B' },
				{ id: 'c3', tagName: 'B' },
			],
		},
	},
	'patch sets value, tagName, parent and namespace -> replaced': {
		record: {},
		patch: {
			value: 'v',
			tagName: 'Z',
			parent: { id: 'p', tagName: 'P' },
			namespace: { prefix: 'x', uri: 'urn:x' },
		},
		expected: {
			value: 'v',
			tagName: 'Z',
			parent: { id: 'p', tagName: 'P' },
			namespace: { prefix: 'x', uri: 'urn:x' },
		},
	},
	'patch gives value as undefined -> value kept': {
		record: { value: 'kept' },
		patch: { value: undefined },
		expected: { value: 'kept' },
	},
	'empty patch -> record unchanged': {
		record: { value: 'kept', attributes: [{ name: 'aA', value: 'a' }] },
		patch: {},
		expected: { value: 'kept', attributes: [{ name: 'aA', value: 'a' }] },
	},
}

runTestCases.generic(testCases, (testCase) => {
	const record: AnyRawRecord = { ...RECORD, ...testCase.record }
	const frozen = structuredClone(record)

	const patched = applyRecordPatch({ record, patch: { recordId: record.id, ...testCase.patch } })

	expect(patched).toEqual({ ...RECORD, ...testCase.expected })
	expect(patched).not.toHaveProperty('recordId')
	expect(patched).not.toHaveProperty('removeAttributes')
	expect(record, 'the record given is not changed').toEqual(frozen)
})
