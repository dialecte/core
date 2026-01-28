import { TEST_DIALECTE_CONFIG, DIALECTE_NAMESPACES } from '../'
import { isRawRecord, isChainRecord, isTreeRecord, isFullAttributeArray } from './guard'

import { describe, it, expect } from 'vitest'

import type { RawRecord, ChainRecord, TreeRecord, AttributesOf } from '@/types'

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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
				children: [],
				parent: null,
				value: '',
			},
			expected: true,
		},
		{
			desc: 'rejects ChainRecord (has status)',
			record: {
				id: '1',
				tagName: 'Root',
				namespace: DIALECTE_NAMESPACES.default,
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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
				attributes: {} as AttributesOf<TestConfig, 'Root'>,
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

describe('isChainRecord', () => {
	type TestCase = {
		desc: string
		record: RawRecord<TestConfig, 'Root'> | ChainRecord<TestConfig, 'Root'>
		expected: boolean
	}

	const rawRecord: RawRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: {} as AttributesOf<TestConfig, 'Root'>,
		children: [],
		parent: null,
		value: '',
	}

	const chainRecord: ChainRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: {} as AttributesOf<TestConfig, 'Root'>,
		children: [],
		status: 'unchanged',
		parent: null,
		value: '',
	}

	const testCases: TestCase[] = [
		{
			desc: 'valid ChainRecord with status=unchanged',
			record: chainRecord,
			expected: true,
		},
		{
			desc: 'valid ChainRecord with status=created',
			record: { ...chainRecord, status: 'created' },
			expected: true,
		},
		{
			desc: 'valid ChainRecord with status=updated',
			record: { ...chainRecord, status: 'updated' },
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
			expect(isChainRecord(record)).toBe(expected)
		})
	})
})

describe('isTreeRecord', () => {
	type TestCase = {
		desc: string
		record:
			| RawRecord<TestConfig, 'Root'>
			| ChainRecord<TestConfig, 'Root'>
			| TreeRecord<TestConfig, 'Root'>
		expected: boolean
	}

	const rawRecord: RawRecord<TestConfig, 'Root'> = {
		id: '1',
		tagName: 'Root',
		namespace: DIALECTE_NAMESPACES.default,
		attributes: {} as AttributesOf<TestConfig, 'Root'>,
		children: [],
		parent: null,
		value: '',
	}

	const chainRecord: ChainRecord<TestConfig, 'Root'> = {
		...rawRecord,
		status: 'unchanged',
	}

	const treeRecord: TreeRecord<TestConfig, 'Root'> = {
		...chainRecord,
		tree: [],
	}

	const testCases: TestCase[] = [
		{
			desc: 'valid TreeRecord',
			record: treeRecord,
			expected: true,
		},
		{
			desc: 'valid TreeRecord with children in tree',
			record: { ...treeRecord, tree: [treeRecord] },
			expected: true,
		},
		{
			desc: 'rejects ChainRecord (no tree)',
			record: chainRecord,
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
