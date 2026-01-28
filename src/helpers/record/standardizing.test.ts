import { describe, it, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '../test-fixtures/config'

import { standardizeRecord } from './standardizing'

import type {
	RawRecord,
	FullAttributeObjectOf,
	RuntimeDialecteConfig,
	ElementsOf,
	AttributesValueObjectOf,
	ParentRelationship,
	ChildRelationship,
} from '@/types'

type TestConfig = typeof TEST_DIALECTE_CONFIG
type TestElement = ElementsOf<TestConfig>

const runtimeConfig: RuntimeDialecteConfig<TestConfig> = {
	...TEST_DIALECTE_CONFIG,
	hooks: undefined,
} as unknown as RuntimeDialecteConfig<TestConfig>

type TestCase<GenericElement extends TestElement> = {
	description: string
	input: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestConfig, GenericElement>
			| FullAttributeObjectOf<TestConfig, GenericElement>[]
	}
	expected: {
		attributeCount: number
		hasAttribute: (name: string) => boolean
		getAttribute: (name: string) => string | undefined
	}
}

describe('standardizeRecord', () => {
	describe('attributes handling', () => {
		const testCases = [
			{
				description: 'converts object attributes to array format',
				input: {
					tagName: 'AA_1',
					attributes: {
						aAA_1: 'value1',
						bAA_1: 'value2',
					},
				},
				expected: {
					attributeCount: 2,
					hasAttribute: (name: string) => ['aAA_1', 'bAA_1'].includes(name),
					getAttribute: (name: string) =>
						name === 'aAA_1' ? 'value1' : name === 'bAA_1' ? 'value2' : undefined,
				},
			} satisfies TestCase<'AA_1'>,
			{
				description: 'handles array attributes with qualified attributes',
				input: {
					tagName: 'AA_1',
					attributes: [
						{
							name: 'aAA_1',
							value: 'value1',
							namespace: TEST_DIALECTE_CONFIG.namespaces.default,
						},
						{
							name: 'bAA_1',
							value: 'value2',
							namespace: TEST_DIALECTE_CONFIG.namespaces.default,
						},
					],
				},
				expected: {
					attributeCount: 2,
					hasAttribute: (name: string) => ['aAA_1', 'bAA_1'].includes(name),
					getAttribute: (name: string) =>
						name === 'aAA_1' ? 'value1' : name === 'bAA_1' ? 'value2' : undefined,
				},
			} satisfies TestCase<'AA_1'>,
			{
				description: 'adds default values for required attributes when missing',
				input: {
					tagName: 'AA_1',
					attributes: {} as AttributesValueObjectOf<TestConfig, 'AA_1'>,
				},
				expected: {
					attributeCount: 1,
					hasAttribute: () => true,
					getAttribute: () => '',
				},
			} satisfies TestCase<'AA_1'>,
			{
				description: 'omits optional attributes when not provided',
				input: {
					tagName: 'AA_1',
					attributes: {
						aAA_1: 'value1',
					},
				},
				expected: {
					attributeCount: 1,
					hasAttribute: (name: string) => name === 'aAA_1',
					getAttribute: (name: string) => (name === 'aAA_1' ? 'value1' : undefined),
				},
			} satisfies TestCase<'AA_1'>,
			{
				description: 'handles mixed required and optional attributes',
				input: {
					tagName: 'AA_1',
					attributes: {
						aAA_1: 'required',
						bAA_1: 'optional1',
						cAA_1: 'optional2',
					},
				},
				expected: {
					attributeCount: 3,
					hasAttribute: (name: string) => ['aAA_1', 'bAA_1', 'cAA_1'].includes(name),
					getAttribute: (name: string) =>
						name === 'aAA_1'
							? 'required'
							: name === 'bAA_1'
								? 'optional1'
								: name === 'cAA_1'
									? 'optional2'
									: undefined,
				},
			} satisfies TestCase<'AA_1'>,
		]

		testCases.forEach((testCase) => {
			it(testCase.description, () => {
				const result = standardizeRecord({
					record: testCase.input as RawRecord<TestConfig, TestElement>,
					dialecteConfig: runtimeConfig,
				})

				expect(result.attributes).toHaveLength(testCase.expected.attributeCount)

				result.attributes.forEach((attr) => {
					expect(testCase.expected.hasAttribute(attr.name)).toBe(true)
					expect(attr.value).toBe(testCase.expected.getAttribute(attr.name))
				})
			})
		})
	})

	describe('record structure', () => {
		it('generates UUID when id not provided', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1' },
				dialecteConfig: runtimeConfig,
			})

			expect(result.id).toBeDefined()
			expect(typeof result.id).toBe('string')
			expect(result.id.length).toBeGreaterThan(0)
		})

		it('preserves provided id', () => {
			const customId = 'custom-id-123'
			const result = standardizeRecord({
				record: { tagName: 'AA_1', id: customId },
				dialecteConfig: runtimeConfig,
			})

			expect(result.id).toBe(customId)
		})

		it('validates RawRecord structure', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1' },
				dialecteConfig: runtimeConfig,
			})

			expect(result).toHaveProperty('id')
			expect(result).toHaveProperty('tagName')
			expect(result).toHaveProperty('namespace')
			expect(result).toHaveProperty('attributes')
			expect(result).toHaveProperty('children')
			expect(result).toHaveProperty('parent')
			expect(result).toHaveProperty('value')
			expect(result).not.toHaveProperty('status')
		})

		it('sets dialecte namespace for known elements', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1' },
				dialecteConfig: runtimeConfig,
			})

			expect(result.namespace).toEqual(TEST_DIALECTE_CONFIG.namespaces.default)
		})

		it('preserves custom namespace for unknown elements', () => {
			const customNamespace = { prefix: 'custom', uri: 'http://custom.org' }
			const result = standardizeRecord({
				record: {
					tagName: 'UnknownElement' as TestElement,
					namespace: customNamespace,
				},
				dialecteConfig: runtimeConfig,
			})

			expect(result.namespace).toEqual(customNamespace)
		})

		it('preserves parent and children', () => {
			const parent = {
				id: 'parent-id',
				tagName: 'A',
			} as ParentRelationship<TestConfig, TestElement>

			const child = {
				id: 'child-id',
				tagName: 'AA_2',
			} as ChildRelationship<TestConfig, TestElement>

			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					parent,
					children: [child],
				},
				dialecteConfig: runtimeConfig,
			})

			expect(result.parent).toBe(parent)
			expect(result.children).toHaveLength(1)
			expect(result.children[0]).toBe(child)
		})

		it('preserves value', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1', value: 'test value' },
				dialecteConfig: runtimeConfig,
			})

			expect(result.value).toBe('test value')
		})
	})

	describe('non-dialecte elements', () => {
		it('returns input record with attributes preserved for unknown elements', () => {
			const unknownElement = {
				tagName: 'UnknownElement',
				attributes: [
					{ name: 'attr1', value: 'val1', namespace: undefined },
					{ name: 'attr2', value: 'val2', namespace: undefined },
				],
			}

			const result = standardizeRecord({
				record: unknownElement as unknown as RawRecord<TestConfig, TestElement>,
				dialecteConfig: runtimeConfig,
			})

			expect(result.tagName).toBe('UnknownElement')
			expect(result.attributes).toHaveLength(2)
			expect(result.attributes[0]).toEqual({ name: 'attr1', value: 'val1', namespace: undefined })
			expect(result.attributes[1]).toEqual({ name: 'attr2', value: 'val2', namespace: undefined })
		})
	})

	describe('hook integration', () => {
		it('calls afterStandardizedRecord hook if provided', () => {
			let hookCalled = false
			let hookRecord: RawRecord<TestConfig, TestElement> | undefined

			const configWithHook: RuntimeDialecteConfig<TestConfig> = {
				...TEST_DIALECTE_CONFIG,
				hooks: {
					afterStandardizedRecord: ({ record }: { record: RawRecord<TestConfig, TestElement> }) => {
						hookCalled = true
						hookRecord = record
						return {
							...record,
							value: 'modified by hook',
						}
					},
				},
			} as unknown as RuntimeDialecteConfig<TestConfig>

			const result = standardizeRecord({
				record: { tagName: 'AA_1', value: 'original' },
				dialecteConfig: configWithHook,
			})

			expect(hookCalled).toBe(true)
			expect(hookRecord).toBeDefined()
			expect(result.value).toBe('modified by hook')
		})
	})
})
