import { XMLNS_NAMESPACE_URI } from './constant'
import { readAttribute, readAttributes } from './read-attributes'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyAttribute, AnyRawRecord, TreeRecord } from '@/types'
import type { AttributeDefaults } from '@/utils'

const dialecteConfig = TEST_DIALECTE_CONFIG
const { default: defaultNamespace, ext } = DIALECTE_TEST_NAMESPACES
/** A namespace declaration as the parser stores it: by its prefix alone, in the xmlns namespace. */
const parsedDeclaration = {
	name: 'ext',
	value: ext.uri,
	namespace: { prefix: 'xmlns', uri: XMLNS_NAMESPACE_URI },
}

/** A record as an import pass holds it: untyped, attributes as stored. */
function heldRecord(params: { tagName: string; attributes?: AnyAttribute[] }): AnyRawRecord {
	const { tagName, attributes = [] } = params
	return {
		id: `${tagName}-1`,
		tagName,
		namespace: defaultNamespace,
		attributes,
		value: '',
		parent: null,
		children: [],
	}
}

describe('readAttribute', () => {
	type TestCase = BaseTestCase & {
		record: AnyRawRecord
		name: string
		namespace?: string
		defaults?: AttributeDefaults
		expected: string
	}

	const testCases: Record<string, TestCase> = {
		'stored value -> that value': {
			record: heldRecord({ tagName: 'A', attributes: [{ name: 'aA', value: 'HELLO' }] }),
			name: 'aA',
			expected: 'HELLO',
		},
		'absent, no schema value -> empty string': {
			record: heldRecord({ tagName: 'A' }),
			name: 'aA',
			expected: '',
		},
		'absent fixed attribute -> its fixed value': {
			record: heldRecord({ tagName: 'CC_1' }),
			name: 'aCC_1',
			expected: 'fixed_val',
		},
		'absent with a non-empty default -> the default': {
			record: heldRecord({ tagName: 'BBB_1' }),
			name: 'bBBB_1',
			expected: 'false',
		},
		"absent fixed attribute, defaults 'none' -> empty string": {
			record: heldRecord({ tagName: 'CC_1' }),
			name: 'aCC_1',
			defaults: 'none',
			expected: '',
		},
		"absent required attribute, defaults 'required' -> empty string": {
			record: heldRecord({ tagName: 'AA_1' }),
			name: 'aAA_1',
			defaults: 'required',
			expected: '',
		},
		"absent optional with a default, defaults 'required' -> empty string, not the default": {
			record: heldRecord({ tagName: 'BBB_1' }),
			name: 'bBBB_1',
			defaults: 'required',
			expected: '',
		},
		'stored empty value -> empty string, not the default': {
			record: heldRecord({ tagName: 'BBB_1', attributes: [{ name: 'bBBB_1', value: '' }] }),
			name: 'bBBB_1',
			expected: '',
		},
		'absent namespaced attribute with a default, namespace scope -> its default': {
			record: heldRecord({ tagName: 'Root' }),
			name: 'root',
			namespace: 'ext',
			expected: '2',
		},
		'element the config does not know, absent -> empty string': {
			record: heldRecord({ tagName: 'Unknown' }),
			name: 'aA',
			expected: '',
		},
		'namespace scope -> the local name read under its prefix': {
			record: heldRecord({
				tagName: 'A',
				attributes: [
					{ name: 'cA', value: 'unqualified' },
					{ name: 'ext:cA', value: 'qualified', namespace: ext },
				],
			}),
			name: 'cA',
			namespace: 'ext',
			expected: 'qualified',
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const { record, name, namespace, defaults, expected } = testCase
		expect(readAttribute({ record, dialecteConfig, name, namespace, defaults })).toBe(expected)
	})
})

describe('readAttribute (fullObject)', () => {
	type TestCase = BaseTestCase & {
		record: AnyRawRecord
		name: string
		namespace?: string
		defaults?: AttributeDefaults
		expected: AnyAttribute | undefined
	}

	const testCases: Record<string, TestCase> = {
		"absent, defaults 'none' -> undefined": {
			record: heldRecord({ tagName: 'BBB_1' }),
			name: 'bBBB_1',
			defaults: 'none',
			expected: undefined,
		},
		"stored empty value, defaults 'none' -> the stored object": {
			record: heldRecord({ tagName: 'BBB_1', attributes: [{ name: 'bBBB_1', value: '' }] }),
			name: 'bBBB_1',
			defaults: 'none',
			expected: { name: 'bBBB_1', value: '' },
		},
		'stored namespaced value -> the stored object with its namespace': {
			record: heldRecord({
				tagName: 'A',
				attributes: [{ name: 'ext:cA', value: 'qualified', namespace: ext }],
			}),
			name: 'ext:cA',
			expected: { name: 'ext:cA', value: 'qualified', namespace: ext },
		},
		'absent fixed attribute -> an object synthesized from the schema': {
			record: heldRecord({ tagName: 'CC_1' }),
			name: 'aCC_1',
			expected: { name: 'aCC_1', value: 'fixed_val' },
		},
		'absent, no schema value -> undefined': {
			record: heldRecord({ tagName: 'A' }),
			name: 'aA',
			expected: undefined,
		},
		'absent namespaced attribute with a default, namespace scope -> an object in its namespace': {
			record: heldRecord({ tagName: 'Root' }),
			name: 'root',
			namespace: 'ext',
			expected: { name: 'ext:root', value: '2', namespace: ext },
		},
		"absent required attribute, defaults 'required' -> an object with an empty value": {
			record: heldRecord({ tagName: 'AA_1' }),
			name: 'aAA_1',
			defaults: 'required',
			expected: { name: 'aAA_1', value: '' },
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const { record, name, namespace, defaults, expected } = testCase
		expect(
			readAttribute({ record, dialecteConfig, name, namespace, defaults, fullObject: true }),
		).toEqual(expected)
	})

	it('stored attribute -> the stored object itself, not a copy', () => {
		const record = heldRecord({ tagName: 'A', attributes: [{ name: 'aA', value: 'HELLO' }] })
		expect(readAttribute({ record, dialecteConfig, name: 'aA', fullObject: true })).toBe(
			record.attributes[0],
		)
	})
})

describe('readAttributes', () => {
	type TestCase = BaseTestCase & {
		record: AnyRawRecord
		namespace?: string
		defaults?: AttributeDefaults
		expected: Record<string, string>
	}

	const testCases: Record<string, TestCase> = {
		'stored attributes -> each under the name it is stored by': {
			record: heldRecord({
				tagName: 'A',
				attributes: [
					{ name: 'aA', value: 'HELLO' },
					{ name: 'ext:cA', value: 'qualified', namespace: ext },
				],
			}),
			expected: { aA: 'HELLO', 'ext:cA': 'qualified' },
		},
		'absent fixed attribute -> filled with its fixed value': {
			record: heldRecord({ tagName: 'CC_1' }),
			expected: { aCC_1: 'fixed_val' },
		},
		'absent with a non-empty default -> filled with the default': {
			record: heldRecord({ tagName: 'BBB_1' }),
			expected: { bBBB_1: 'false' },
		},
		'absent with an empty default -> left out': {
			record: heldRecord({ tagName: 'BB_1' }),
			expected: {},
		},
		"absent fixed attribute, defaults 'none' -> left out": {
			record: heldRecord({ tagName: 'CC_1' }),
			defaults: 'none',
			expected: {},
		},
		"absent required attribute, defaults 'required' -> filled with an empty string": {
			record: heldRecord({ tagName: 'AA_1' }),
			defaults: 'required',
			expected: { aAA_1: '' },
		},
		'stored empty value -> kept, not replaced by the default': {
			record: heldRecord({ tagName: 'BBB_1', attributes: [{ name: 'bBBB_1', value: '' }] }),
			expected: { bBBB_1: '' },
		},
		'namespace declarations -> left out': {
			record: heldRecord({
				tagName: 'A',
				attributes: [
					{ name: 'aA', value: 'HELLO' },
					{ name: 'xmlns:ext', value: ext.uri },
				],
			}),
			defaults: 'none',
			expected: { aA: 'HELLO' },
		},
		'namespace scope -> only that namespace, keyed by local name': {
			record: heldRecord({
				tagName: 'A',
				attributes: [
					{ name: 'aA', value: 'HELLO' },
					{ name: 'ext:cA', value: 'qualified', namespace: ext },
				],
			}),
			namespace: 'ext',
			expected: { cA: 'qualified' },
		},
		'namespace declaration as parsed -> left out': {
			record: heldRecord({
				tagName: 'A',
				attributes: [{ name: 'aA', value: 'HELLO' }, parsedDeclaration],
			}),
			defaults: 'none',
			expected: { aA: 'HELLO' },
		},
		'absent attributes with defaults, one namespaced -> each filled under its stored name': {
			record: heldRecord({ tagName: 'Root' }),
			expected: { 'ext:root': '2', root: '1' },
		},
		'absent namespaced attribute with a default, namespace scope -> filled under its local name': {
			record: heldRecord({ tagName: 'Root' }),
			namespace: 'ext',
			expected: { root: '2' },
		},
		'element the config does not know -> its stored attributes, nothing filled': {
			record: heldRecord({ tagName: 'Unknown', attributes: [{ name: 'aA', value: 'HELLO' }] }),
			expected: { aA: 'HELLO' },
		},
		'namespace scope with no attribute in it -> empty object': {
			record: heldRecord({ tagName: 'A', attributes: [{ name: 'aA', value: 'HELLO' }] }),
			namespace: 'ext',
			expected: {},
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const { record, namespace, defaults, expected } = testCase
		expect(readAttributes({ record, dialecteConfig, namespace, defaults })).toEqual(expected)
	})
})

describe('readAttributes (fullObject)', () => {
	type TestCase = BaseTestCase & {
		record: AnyRawRecord
		defaults?: AttributeDefaults
		expected: AnyAttribute[]
	}

	const testCases: Record<string, TestCase> = {
		"stored attributes, defaults 'none' -> exactly the stored objects": {
			record: heldRecord({
				tagName: 'CC_1',
				attributes: [{ name: 'ext:cCC_1', value: 'qualified', namespace: ext }],
			}),
			defaults: 'none',
			expected: [{ name: 'ext:cCC_1', value: 'qualified', namespace: ext }],
		},
		'absent fixed attribute -> an object synthesized after the stored ones': {
			record: heldRecord({
				tagName: 'CC_1',
				attributes: [{ name: 'ext:cCC_1', value: 'qualified', namespace: ext }],
			}),
			expected: [
				{ name: 'ext:cCC_1', value: 'qualified', namespace: ext },
				{ name: 'aCC_1', value: 'fixed_val' },
			],
		},
		"absent required attribute, defaults 'required' -> an object with an empty value": {
			record: heldRecord({ tagName: 'AA_1' }),
			defaults: 'required',
			expected: [{ name: 'aAA_1', value: '' }],
		},
		'absent, no schema value -> no object': {
			record: heldRecord({ tagName: 'A' }),
			expected: [],
		},
		'absent namespaced attribute with a default -> an object in its namespace': {
			record: heldRecord({ tagName: 'Root', attributes: [{ name: 'root', value: '1' }] }),
			expected: [
				{ name: 'root', value: '1' },
				{ name: 'ext:root', value: '2', namespace: ext },
			],
		},
		'namespace declaration as parsed -> kept, as stored': {
			record: heldRecord({ tagName: 'A', attributes: [parsedDeclaration] }),
			defaults: 'none',
			expected: [parsedDeclaration],
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		const { record, defaults, expected } = testCase
		expect(readAttributes({ record, dialecteConfig, defaults, fullObject: true })).toEqual(expected)
	})
})

describe('readAttribute(s) types', () => {
	it('a typed record -> accepted as it is, read as plain strings (typed reads: the query)', () => {
		const record = {
			...heldRecord({ tagName: 'CC_1' }),
			status: 'unchanged',
			tree: [],
		} as TreeRecord<typeof dialecteConfig, 'CC_1'>
		expectTypeOf(readAttribute({ record, dialecteConfig, name: 'aCC_1' })).toEqualTypeOf<string>()
		expectTypeOf(readAttributes({ record, dialecteConfig })).toEqualTypeOf<Record<string, string>>()
	})

	it('an untyped record -> plain strings, no cast', () => {
		const record = heldRecord({ tagName: 'CC_1' })
		expectTypeOf(readAttribute({ record, dialecteConfig, name: 'aCC_1' })).toEqualTypeOf<string>()
		expectTypeOf(
			readAttribute({ record, dialecteConfig, name: 'aCC_1', fullObject: true }),
		).toEqualTypeOf<AnyAttribute | undefined>()
		expectTypeOf(readAttributes({ record, dialecteConfig })).toEqualTypeOf<Record<string, string>>()
		expectTypeOf(readAttributes({ record, dialecteConfig, fullObject: true })).toEqualTypeOf<
			AnyAttribute[]
		>()
	})
})
