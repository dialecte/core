import {
	isRawRecord,
	isTrackedRecord,
	isTreeRecord,
	isFullAttributeArray,
	isRecordOf,
} from './guard'

import { describe, expect } from 'vitest'

import { DIALECTE_NAMESPACES, runTestCases } from '@/test'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { BaseTestCase } from '@/test'
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
	type TestCase = BaseTestCase & {
		record: unknown
		expected: boolean
	}

	const testCases: Record<string, TestCase> = {
		'valid RawRecord': {
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
		'rejects TrackedRecord (has status)': {
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
		'rejects TreeRecord (has status and tree)': {
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
		'rejects object missing id': {
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
		'rejects object missing tagName': {
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
		'rejects object missing namespace': {
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
		'rejects object missing attributes': {
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
		'rejects object missing children': {
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
		'rejects object missing parent': {
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
		'rejects object missing value': {
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
		'rejects object with extra properties': {
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
	}

	function act({ record, expected }: TestCase) {
		expect(isRawRecord(record)).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})

describe('isTrackedRecord', () => {
	type TestCase = BaseTestCase & {
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

	const testCases: Record<string, TestCase> = {
		'valid TrackedRecord with status=unchanged': {
			record: trackedRecord,
			expected: true,
		},
		'valid TrackedRecord with status=created': {
			record: { ...trackedRecord, status: 'created' },
			expected: true,
		},
		'valid TrackedRecord with status=updated': {
			record: { ...trackedRecord, status: 'updated' },
			expected: true,
		},
		'rejects RawRecord (no status)': {
			record: rawRecord,
			expected: false,
		},
	}

	function act({ record, expected }: TestCase) {
		expect(isTrackedRecord(record)).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})

describe('isTreeRecord', () => {
	type TestCase = BaseTestCase & {
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

	const testCases: Record<string, TestCase> = {
		'valid TreeRecord': {
			record: treeRecord,
			expected: true,
		},
		'valid TreeRecord with children in tree': {
			record: { ...treeRecord, tree: rootTreeRecords },
			expected: true,
		},
		'rejects TrackedRecord (no tree)': {
			record: trackedRecord,
			expected: false,
		},
		'rejects RawRecord': {
			record: rawRecord,
			expected: false,
		},
	}

	function act({ record, expected }: TestCase) {
		expect(isTreeRecord(record)).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})

describe('isFullAttributeArray', () => {
	type TestCase = BaseTestCase & {
		attributes: unknown
		expected: boolean
	}

	const testCases: Record<string, TestCase> = {
		'array with FullAttributeObjects': {
			attributes: [
				{ name: 'aAA_1', value: 'value1', namespace: DIALECTE_NAMESPACES.default },
				{ name: 'bAA_1', value: 'value2', namespace: DIALECTE_NAMESPACES.default },
			],
			expected: true,
		},
		'empty array': {
			attributes: [],
			expected: true,
		},
		'object with AttributesValueObject': {
			attributes: {
				aAA_1: 'value1',
				bAA_1: 'value2',
			},
			expected: false,
		},
		'empty object': {
			attributes: {},
			expected: false,
		},
	}

	function act({ attributes, expected }: TestCase) {
		expect(isFullAttributeArray(attributes)).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})

describe('isRecordOf', () => {
	type TestCase = BaseTestCase & {
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

	const testCases: Record<string, TestCase> = {
		'RawRecord matches given tagName': {
			record: rawRecord,
			tagName: 'Root',
			expected: true,
		},
		'TrackedRecord matches given tagName': {
			record: trackedRecord,
			tagName: 'Root',
			expected: true,
		},
		'TreeRecord matches given tagName': {
			record: treeRecord,
			tagName: 'Root',
			expected: true,
		},
		'rejects RawRecord with different tagName': {
			record: rawRecord,
			tagName: 'A',
			expected: false,
		},
		'rejects TrackedRecord with different tagName': {
			record: trackedRecord,
			tagName: 'A',
			expected: false,
		},
		'rejects TreeRecord with different tagName': {
			record: treeRecord,
			tagName: 'A',
			expected: false,
		},
		'matches record whose tagName is A': {
			record: { ...base, tagName: 'A' } as AnyRawRecord,
			tagName: 'A',
			expected: true,
		},
	}

	function act({ record, tagName, expected }: TestCase) {
		expect(isRecordOf(record, tagName)).toBe(expected)
	}

	runTestCases.generic(testCases, act)
})
