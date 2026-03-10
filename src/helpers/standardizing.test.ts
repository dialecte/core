import { standardizeRecord } from './standardizing'

import { describe, expect, it } from 'vitest'

import { DIALECTE_NAMESPACES, TEST_DIALECTE_CONFIG, TestDialecteConfig } from '@/test-fixtures'

import type {
	AnyDialecteConfig,
	TransactionHooks,
	ElementsOf,
	FullAttributeObjectOf,
	RawRecord,
} from '@/types'

// ── Shared helpers ────────────────────────────────────────────────────────────

const ns = DIALECTE_NAMESPACES
const config = TEST_DIALECTE_CONFIG

// ── Attributes handling ───────────────────────────────────────────────────────

describe('standardizeRecord', () => {
	describe('attributes handling', () => {
		type TestCase = {
			description: string
			input: Parameters<typeof standardizeRecord>[0]['record']
			expectedAttributes: { name: string; value: string }[]
		}

		const testCases: TestCase[] = [
			{
				description: 'converts object attributes to array format',
				input: { tagName: 'AA_1', attributes: { aAA_1: 'value1', bAA_1: 'value2' } },
				expectedAttributes: [
					{ name: 'aAA_1', value: 'value1' },
					{ name: 'bAA_1', value: 'value2' },
				],
			},
			{
				description: 'converts qualified array attributes',
				input: {
					tagName: 'AA_1',
					attributes: [
						{ name: 'aAA_1', value: 'value1', namespace: ns.default },
						{ name: 'bAA_1', value: 'value2', namespace: ns.default },
					],
				},
				expectedAttributes: [
					{ name: 'aAA_1', value: 'value1' },
					{ name: 'bAA_1', value: 'value2' },
				],
			},
			{
				description: 'adds empty default for required attribute when missing',
				input: { tagName: 'AA_1', attributes: {} as { aAA_1: string } },
				expectedAttributes: [{ name: 'aAA_1', value: '' }],
			},
			{
				description: 'omits optional attributes when not provided',
				input: { tagName: 'AA_1', attributes: { aAA_1: 'required' } },
				expectedAttributes: [{ name: 'aAA_1', value: 'required' }],
			},
			{
				description: 'includes all provided optional attributes alongside required',
				input: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'required', bAA_1: 'optional1', cAA_1: 'optional2' },
				},
				expectedAttributes: [
					{ name: 'aAA_1', value: 'required' },
					{ name: 'bAA_1', value: 'optional1' },
					{ name: 'cAA_1', value: 'optional2' },
				],
			},
		]

		it.each(testCases)('$description', ({ input, expectedAttributes }) => {
			const result = standardizeRecord({ record: input as any, dialecteConfig: config })

			expect(result.attributes).toHaveLength(expectedAttributes.length)
			for (const expected of expectedAttributes) {
				expect(result.attributes).toContainEqual(expect.objectContaining(expected))
			}
		})

		it('preserves namespace from schema for standard attributes', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1', attributes: { aAA_1: 'v', cAA_1: 'x' } },
				dialecteConfig: config,
			})

			const a: FullAttributeObjectOf<TestDialecteConfig, 'AA_1'> | undefined =
				result.attributes.find((attribute) => attribute.name === 'aAA_1')
			const c: FullAttributeObjectOf<TestDialecteConfig, 'AA_1'> | undefined =
				result.attributes.find((attribute) => attribute.name === 'cAA_1')

			expect(a?.namespace).toEqual(ns.default)
			expect(c?.namespace).toEqual(ns.ext)
		})

		it('appends extra qualified attributes not in schema sequence', () => {
			const extra = { name: 'clone-index', value: 'aa1-0', namespace: ns.dev }

			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [{ name: 'aAA_1', value: 'v', namespace: ns.default }, extra as any],
				},
				dialecteConfig: config,
			})

			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'aAA_1', value: 'v' }),
			)
			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'clone-index', value: 'aa1-0', namespace: ns.dev }),
			)
		})

		it('does not copy extra unnamespaced attributes outside of schema', () => {
			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [
						{ name: 'aAA_1', value: 'v', namespace: ns.default },
						{ name: 'unknown-attr', value: 'x' } as any,
					],
				},
				dialecteConfig: config,
			})

			expect(
				result.attributes.find((attribute) => attribute.name === ('unknown-attr' as any)),
			).toBeUndefined()
		})
	})

	// ── Record structure ──────────────────────────────────────────────────────

	describe('record structure', () => {
		it('generates uuid when id is not provided', () => {
			const result = standardizeRecord({ record: { tagName: 'AA_1' }, dialecteConfig: config })

			expect(typeof result.id).toBe('string')
			expect(result.id.length).toBeGreaterThan(0)
		})

		it('preserves provided id', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1', id: 'custom-id' },
				dialecteConfig: config,
			})

			expect(result.id).toBe('custom-id')
		})

		it('has all required RawRecord keys and no status', () => {
			const result = standardizeRecord({ record: { tagName: 'AA_1' }, dialecteConfig: config })

			expect(result).toHaveProperty('id')
			expect(result).toHaveProperty('tagName')
			expect(result).toHaveProperty('namespace')
			expect(result).toHaveProperty('attributes')
			expect(result).toHaveProperty('children')
			expect(result).toHaveProperty('parent')
			expect(result).toHaveProperty('value')
			expect(result).not.toHaveProperty('status')
		})

		it('sets schema namespace for known elements', () => {
			const result = standardizeRecord({ record: { tagName: 'AA_1' }, dialecteConfig: config })

			expect(result.namespace).toEqual(ns.default)
		})

		it('preserves custom namespace for unknown elements', () => {
			const custom = { prefix: 'custom', uri: 'http://custom.org' }
			const result = standardizeRecord({
				record: { tagName: 'Unknown' as any, namespace: custom },
				dialecteConfig: config,
			})

			expect(result.namespace).toEqual(custom)
		})

		it('preserves parent and children relationships', () => {
			const parent = { id: 'p1', tagName: 'A' as any }
			const child = { id: 'c1', tagName: 'AA_2' as any }

			const result = standardizeRecord({
				record: { tagName: 'AA_1', parent, children: [child] },
				dialecteConfig: config,
			})

			expect(result.parent).toBe(parent)
			expect(result.children).toHaveLength(1)
			expect(result.children[0]).toBe(child)
		})

		it('preserves text value', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1', value: 'text content' },
				dialecteConfig: config,
			})

			expect(result.value).toBe('text content')
		})
	})

	// ── Non-dialecte elements ─────────────────────────────────────────────────

	describe('non-dialecte elements', () => {
		it('returns attributes as-is without schema standardization', () => {
			const result = standardizeRecord({
				record: {
					tagName: 'Unknown' as any,
					attributes: [
						{ name: 'attr1', value: 'val1' },
						{ name: 'attr2', value: 'val2' },
					],
				},
				dialecteConfig: config,
			})

			expect(result.attributes).toHaveLength(2)
			expect(result.attributes[0]).toMatchObject({ name: 'attr1', value: 'val1' })
			expect(result.attributes[1]).toMatchObject({ name: 'attr2', value: 'val2' })
		})
	})

	// ── Hook integration ──────────────────────────────────────────────────────

	describe('afterStandardizedRecord hook', () => {
		it('calls the hook and applies the returned record', () => {
			let hookCalled = false

			const configWithHook = {
				...config,
				hooks: {
					afterStandardizedRecord: <C extends AnyDialecteConfig, E extends ElementsOf<C>>({
						record,
					}: {
						record: RawRecord<C, E>
					}): RawRecord<C, E> => {
						hookCalled = true
						return { ...record, value: 'from hook' }
					},
				} satisfies TransactionHooks,
			}

			const result = standardizeRecord({
				record: { tagName: 'AA_1', value: 'original' },
				dialecteConfig: configWithHook,
			})

			expect(hookCalled).toBe(true)
			expect(result.value).toBe('from hook')
		})
	})
})
