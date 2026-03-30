import {
	isRawRecord,
	isTrackedRecord,
	isTreeRecord,
	isFullAttributeArray,
	isRecordOf,
} from './guard'

import { describe, it, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, DIALECTE_NAMESPACES } from '@/test'

import type {
	RawRecord,
	TrackedRecord,
	TreeRecord,
	AnyRawRecord,
	AnyTrackedRecord,
	AnyTreeRecord,
	ElementsOf,
} from '@/types'

type TestConfig = typeof TEST_DIALECTE_CONFIG

describe('isRawRecord', () => {
	type TestCase = {
		desc: string
		record: unknown
		expected: boolean
	}

	const testCases: TestCase[] = [
		{
			desc: 'valid RawRecord',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				parent: null,
				value: '',
			},
			expected: true,
		},
		{
			desc: 'rejects TrackedRecord (has status)',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				status: 'unchanged',
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects TreeRecord (has status and tree)',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				parent: null,
				value: '',
				status: 'unchanged',
				tree: [],
			},
			expected: false,
		},
		{
			desc: 'rejects object missing id',
			record: {
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing tagName',
			record: {
				id: '1',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing namespace',
			record: {
				id: '1',
				tagName: 'Root',
				attributes: [],
				children: [],
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing attributes',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				children: [],
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing children',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				parent: null,
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing parent',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				value: '',
			},
			expected: false,
		},
		{
			desc: 'rejects object missing value',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: [],
				children: [],
				parent: null,
			},
			expected: false,
		},
		{
			desc: 'rejects object with extra properties',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: {},
				children: [],
				extra: 'property',
			},
			expected: false,
		},
	]

	testCases.forEach(({ desc, record, expected }) => {
		it(desc, () => {
			expect(isRawRecord(record)).toBe(expected)
		})
	})
})

describe('isTrackedRecord', () => {
	type TestCase = {
		desc: string
		record: RawRecord<TestConfig, 'Root'> | TrackedRecord<TestConfig, 'Root'>
		expected: boolean
	}

	const rawRecord: RawRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: [],
		children: [],
		parent: null,
		value: '',
	}

	const trackedRecord: TrackedRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: [],
		children: [],
		status: 'unchanged',
		parent: null,
		value: '',
	}

	const testCases: TestCase[] = [
		{
			desc: 'valid TrackedRecord with status=unchanged',
			record: trackedRecord,
			expected: true,
		},
		{
			desc: 'valid TrackedRecord with status=created',
			record: { ...trackedRecord, status: 'created' },
			expected: true,
		},
		{
			desc: 'valid TrackedRecord with status=updated',
			record: { ...trackedRecord, status: 'updated' },
			expected: true,
		},
		{
			desc: 'rejects RawRecord (no status)',
			record: rawRecord,
			expected: false,
		},
	]

	testCases.forEach(({ desc, record, expected }) => {
		it(desc, () => {
			expect(isTrackedRecord(record)).toBe(expected)
		})
	})
})

describe('isTreeRecord', () => {
	type TestCase = {
		desc: string
		record:
			| RawRecord<TestConfig, 'Root'>
			| TrackedRecord<TestConfig, 'Root'>
			| TreeRecord<TestConfig, 'Root'>
		expected: boolean
	}

	const rawRecord: RawRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: [],
		children: [],
		parent: null,
		value: '',
	}

	const trackedRecord: TrackedRecord<TestConfig, 'Root'> = {
		...rawRecord,
		status: 'unchanged',
	}

	const treeRecord: TreeRecord<TestConfig, 'Root'> = {
		...trackedRecord,
		tree: [],
	}

	const rootTreeRecords: TreeRecord<TestConfig, 'Root'>['tree'] = [
		{
			id: '2',
			tagName: 'A',
			namespace: DIALECTE_NAMESPACES.default,
			attributes: [],
			children: [],
			parent: { id: '1', tagName: 'Root' },
			value: '',
			status: 'unchanged',
			tree: [],
		},
	]

	const testCases: TestCase[] = [
		{
			desc: 'valid TreeRecord',
			record: treeRecord,
			expected: true,
		},
		{
			desc: 'valid TreeRecord with children in tree',
			record: { ...treeRecord, tree: rootTreeRecords },
			expected: true,
		},
		{
			desc: 'rejects TrackedRecord (no tree)',
			record: trackedRecord,
			expected: false,
		},
		{
			desc: 'rejects RawRecord',
			record: rawRecord,
			expected: false,
		},
	]

	testCases.forEach(({ desc, record, expected }) => {
		it(desc, () => {
			expect(isTreeRecord(record)).toBe(expected)
		})
	})
})

describe('isFullAttributeArray', () => {
	type TestCase = {
		desc: string
		attributes: unknown
		expected: boolean
	}

	const testCases: TestCase[] = [
		{
			desc: 'array with FullAttributeObjects',
			attributes: [
				{ name: 'aAA_1', value: 'value1', namespace: DIALECTE_NAMESPACES.default },
				{ name: 'bAA_1', value: 'value2', namespace: DIALECTE_NAMESPACES.default },
			],
			expected: true,
		},
		{
			desc: 'empty array',
			attributes: [],
			expected: true,
		},
		{
			desc: 'object with AttributesValueObject',
			attributes: {
				aAA_1: 'value1',
				bAA_1: 'value2',
			},
			expected: false,
		},
		{
			desc: 'empty object',
			attributes: {},
			expected: false,
		},
	]

	testCases.forEach(({ desc, attributes, expected }) => {
		it(desc, () => {
			expect(isFullAttributeArray(attributes)).toBe(expected)
		})
	})
})

describe('isRecordOf', () => {
	type TestCase = {
		desc: string
		record: AnyRawRecord | AnyTrackedRecord | AnyTreeRecord
		tagName: ElementsOf<TestConfig>
		expected: boolean
	}

	const base = {
		id: '1',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: [],
		children: [],
		parent: null,
		value: '',
	}

	const rawRecord: RawRecord<TestConfig, 'Root'> = { ...base, tagName: 'Root' }
	const trackedRecord: TrackedRecord<TestConfig, 'Root'> = {
		...base,
		tagName: 'Root',
		status: 'unchanged',
	}
	const treeRecord: TreeRecord<TestConfig, 'Root'> = {
		...base,
		tagName: 'Root',
		status: 'unchanged',
		tree: [],
	}

	const testCases: TestCase[] = [
		{
			desc: 'RawRecord matches given tagName',
			record: rawRecord,
			tagName: 'Root',
			expected: true,
		},
		{
			desc: 'TrackedRecord matches given tagName',
			record: trackedRecord,
			tagName: 'Root',
			expected: true,
		},
		{
			desc: 'TreeRecord matches given tagName',
			record: treeRecord,
			tagName: 'Root',
			expected: true,
		},
		{
			desc: 'rejects RawRecord with different tagName',
			record: rawRecord,
			tagName: 'A',
			expected: false,
		},
		{
			desc: 'rejects TrackedRecord with different tagName',
			record: trackedRecord,
			tagName: 'A',
			expected: false,
		},
		{
			desc: 'rejects TreeRecord with different tagName',
			record: treeRecord,
			tagName: 'A',
			expected: false,
		},
		{
			desc: 'matches record whose tagName is A',
			record: { ...base, tagName: 'A' } as AnyRawRecord,
			tagName: 'A',
			expected: true,
		},
	]

	testCases.forEach(({ desc, record, tagName, expected }) => {
		it(desc, () => {
			expect(isRecordOf(record, tagName)).toBe(expected)
		})
	})
})
