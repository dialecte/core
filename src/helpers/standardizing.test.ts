import { standardizeRecord } from './standardizing'

import { describe, expect, it } from 'vitest'

import {
	DIALECTE_TEST_NAMESPACES,
	TEST_DIALECTE_CONFIG,
	TestDialecteConfig,
	runTestCases,
} from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, ElementsOf, FullAttributeObjectOf, RawRecord } from '@/types'

// ── Shared helpers ────────────────────────────────────────────────────────────

const ns = DIALECTE_TEST_NAMESPACES
const config = TEST_DIALECTE_CONFIG

// ── Attributes handling ───────────────────────────────────────────────────────

describe('standardizeRecord', () => {
	describe('attributes handling', () => {
		type TestCase = BaseTestCase & {
			input: Parameters<typeof standardizeRecord>[0]['record']
			expectedAttributes: { name: string; value: string }[]
		}

		const testCases: Record<string, TestCase> = {
			'converts object attributes to array format': {
				input: { tagName: 'AA_1', attributes: { aAA_1: 'value1', bAA_1: 'value2' } },
				expectedAttributes: [
					{ name: 'aAA_1', value: 'value1' },
					{ name: 'bAA_1', value: 'value2' },
				],
			},
			'converts qualified array attributes': {
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
			'adds empty default for required attribute when missing': {
				input: { tagName: 'AA_1', attributes: {} as { aAA_1: string } },
				expectedAttributes: [{ name: 'aAA_1', value: '' }],
			},
			'omits optional attributes when not provided': {
				input: { tagName: 'AA_1', attributes: { aAA_1: 'required' } },
				expectedAttributes: [{ name: 'aAA_1', value: 'required' }],
			},
			'preserves optional attribute with empty-string default when provided': {
				input: { tagName: 'BB_1', attributes: { aBB_1: 'req', bBB_1: '' } },
				expectedAttributes: [
					{ name: 'aBB_1', value: 'req' },
					{ name: 'bBB_1', value: '' },
				],
			},
			'includes optional attribute with empty-string default when provided with value': {
				input: { tagName: 'BB_1', attributes: { aBB_1: 'req', bBB_1: 'val' } },
				expectedAttributes: [
					{ name: 'aBB_1', value: 'req' },
					{ name: 'bBB_1', value: 'val' },
				],
			},
			'uses schema default for optional attribute when not provided': {
				input: { tagName: 'BB_1', attributes: { aBB_1: 'req' } },
				expectedAttributes: [
					{ name: 'aBB_1', value: 'req' },
					{ name: 'bBB_1', value: '' },
				],
			},
			'includes all provided optional attributes alongside required': {
				input: {
					tagName: 'AA_1',
					attributes: { aAA_1: 'required', bAA_1: 'optional1', 'ext:cAA_1': 'optional2' },
				},
				expectedAttributes: [
					{ name: 'aAA_1', value: 'required' },
					{ name: 'bAA_1', value: 'optional1' },
					{ name: 'ext:cAA_1', value: 'optional2' },
				],
			},
		}

		function act(tc: TestCase): void {
			const result = standardizeRecord({ record: tc.input as any, dialecteConfig: config })

			expect(result.attributes).toHaveLength(tc.expectedAttributes.length)
			for (const expected of tc.expectedAttributes) {
				expect(result.attributes).toContainEqual(expect.objectContaining(expected))
			}
		}

		runTestCases.generic(testCases, act)

		it('preserves namespace from schema for standard attributes', () => {
			const result = standardizeRecord({
				record: { tagName: 'AA_1', attributes: { aAA_1: 'v', 'ext:cAA_1': 'x' } },
				dialecteConfig: config,
			})

			const a: FullAttributeObjectOf<TestDialecteConfig, 'AA_1'> | undefined =
				result.attributes.find((attribute) => attribute.name === 'aAA_1')
			const c: FullAttributeObjectOf<TestDialecteConfig, 'AA_1'> | undefined =
				result.attributes.find((attribute) => attribute.name === 'ext:cAA_1')

			expect(a?.namespace).toBeUndefined()
			expect(c?.namespace).toEqual(ns.ext)
		})

		it('appends extra qualified attributes not in schema sequence, keyed by prefix', () => {
			// A non-default-namespace attribute is stored under its prefixed name even when
			// it is not in the schema sequence (dev is non-default) — the two-rule convention.
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
				expect.objectContaining({ name: 'dev:clone-index', value: 'aa1-0', namespace: ns.dev }),
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

		it('stores a parsed non-default attribute (local name + namespace) under its prefixed key', () => {
			// The SAX parser yields a non-default attribute by local name + namespace; it must
			// land on the prefixed schema key `ext:cAA_1` with its value preserved (not defaulted).
			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [
						{ name: 'aAA_1', value: 'v', namespace: ns.default },
						{ name: 'cAA_1', value: 'kept', namespace: ns.ext },
					] as any,
				},
				dialecteConfig: config,
			})

			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'ext:cAA_1', value: 'kept', namespace: ns.ext }),
			)
			expect(
				result.attributes.find((attribute) => attribute.name === ('cAA_1' as any)),
			).toBeUndefined()
		})

		it('canonicalizes created (prefixed key) and imported (local + namespace) forms identically', () => {
			const created = standardizeRecord({
				record: { tagName: 'AA_1', attributes: { aAA_1: 'v', 'ext:cAA_1': 'X' } as any },
				dialecteConfig: config,
			})
			const imported = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [
						{ name: 'aAA_1', value: 'v', namespace: ns.default },
						{ name: 'cAA_1', value: 'X', namespace: ns.ext },
					] as any,
				},
				dialecteConfig: config,
			})

			expect(imported.attributes).toEqual(created.attributes)
		})

		it('resolves a same-local-name collision by namespace (ext:root vs root)', () => {
			// A parsed document yields both `ext:root` and `root` by local name `root`; the
			// non-default one must be keyed `ext:root` and neither value corrupts the other.
			const result = standardizeRecord({
				record: {
					tagName: 'Root',
					attributes: [
						{ name: 'root', value: 'EXT', namespace: ns.ext },
						{ name: 'root', value: 'DEF', namespace: ns.default },
					] as any,
				},
				dialecteConfig: config,
			})

			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'ext:root', value: 'EXT' }),
			)
			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'root', value: 'DEF' }),
			)
		})

		it('throws on a prefixed attribute name with an unresolvable namespace prefix', () => {
			expect(() =>
				standardizeRecord({
					record: { tagName: 'AA_1', attributes: { 'foo:bar': 'x' } as any },
					dialecteConfig: config,
				}),
			).toThrow(/foo/)
		})

		it('orders extra qualified attributes deterministically regardless of input order', () => {
			const extExt = { name: 'alpha', value: '1', namespace: ns.ext }
			const extDev = { name: 'beta', value: '2', namespace: ns.dev }

			const forward = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [{ name: 'aAA_1', value: 'v', namespace: ns.default }, extExt, extDev] as any,
				},
				dialecteConfig: config,
			})
			const reverse = standardizeRecord({
				record: {
					tagName: 'AA_1',
					attributes: [{ name: 'aAA_1', value: 'v', namespace: ns.default }, extDev, extExt] as any,
				},
				dialecteConfig: config,
			})

			// Same attribute set fed in different orders → identical canonical array.
			expect(forward.attributes).toEqual(reverse.attributes)
		})

		it('uses the fixed value for a required attribute when not provided', () => {
			const result = standardizeRecord({ record: { tagName: 'CC_1' }, dialecteConfig: config })

			expect(
				result.attributes.find((attribute) => attribute.name === ('aCC_1' as any))?.value,
			).toBe('fixed_val')
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

	// ── Foreign-namespace element with a colliding local name ──────────────────

	describe('foreign-namespace element colliding with a schema local name', () => {
		// A record whose local name matches a schema element (`AA_1`) but whose namespace is
		// not one the config declares must NOT be standardized against that schema:
		// standardization would overwrite its namespace with the schema one and reorder,
		// default, or drop its attributes. Such a record must pass through untouched.
		const foreign = { prefix: 'foreign', uri: 'http://foreign.example/ns' }

		it('preserves the foreign namespace instead of overwriting it with the schema one', () => {
			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					namespace: foreign,
					attributes: [{ name: 'aAA_1', value: 'v' }],
				},
				dialecteConfig: config,
			})

			expect(result.namespace).toEqual(foreign)
		})

		it('keeps attributes verbatim, without schema ordering or required defaults', () => {
			// Only the optional `bAA_1` is provided; the required `aAA_1` must NOT be
			// auto-filled, proving the record skipped schema standardization.
			const result = standardizeRecord({
				record: {
					tagName: 'AA_1',
					namespace: foreign,
					attributes: [{ name: 'bAA_1', value: 'kept' }],
				},
				dialecteConfig: config,
			})

			expect(result.attributes).toHaveLength(1)
			expect(result.attributes).toContainEqual(
				expect.objectContaining({ name: 'bAA_1', value: 'kept' }),
			)
			expect(
				result.attributes.find((attribute) => attribute.name === ('aAA_1' as any)),
			).toBeUndefined()
		})
	})

	// ── Hook integration ──────────────────────────────────────────────────────

	describe('afterStandardizedRecord hook', () => {
		it('calls the hook and applies the returned record', () => {
			let hookCalled = false

			const hooks = {
				afterStandardizedRecord: <C extends AnyDialecteConfig, E extends ElementsOf<C>>({
					record,
				}: {
					record: RawRecord<C, E>
				}): RawRecord<C, E> => {
					hookCalled = true
					return { ...record, value: 'from hook' }
				},
			}

			const result = standardizeRecord({
				record: { tagName: 'AA_1', value: 'original' },
				dialecteConfig: config,
				hooks,
			})

			expect(hookCalled).toBe(true)
			expect(result.value).toBe('from hook')
		})

		it('re-applies canonical attribute order after the hook', () => {
			// A hook that moves a schema-sequence attribute to the end (mirrors the
			// SCL uuid hook, which appends a generated uuid). Standardization must
			// re-order so the result stays order-canonical for comparison.
			const hooks = {
				afterStandardizedRecord: <C extends AnyDialecteConfig, E extends ElementsOf<C>>({
					record,
				}: {
					record: RawRecord<C, E>
				}): RawRecord<C, E> => ({
					...record,
					attributes: [
						...record.attributes.filter((attribute) => attribute.name !== 'aAA_1'),
						...record.attributes.filter((attribute) => attribute.name === 'aAA_1'),
					],
				}),
			}

			const result = standardizeRecord({
				record: { tagName: 'AA_1', attributes: { aAA_1: 'v', bAA_1: 'w' } },
				dialecteConfig: config,
				hooks,
			})

			expect(result.attributes.map((attribute) => attribute.name)).toEqual(['aAA_1', 'bAA_1'])
		})
	})

	describe('element namespace by parent context', () => {
		it('stamps the parent→child edge namespace override, else the element namespace', () => {
			// Give the Root→A edge an ext-namespace override; A's own namespace is default.
			const configWithEdge = structuredClone(config) as any
			configWithEdge.definition.Root.children.details.A.namespace = ns.ext

			const overridden = standardizeRecord({
				record: {
					tagName: 'A',
					parent: { id: 'root-id', tagName: 'Root' },
					attributes: { aA: 'X' },
				},
				dialecteConfig: configWithEdge,
			})
			expect(overridden.namespace).toEqual(ns.ext)

			// Same element, no edge override → the element's own canonical namespace.
			const canonical = standardizeRecord({
				record: {
					tagName: 'A',
					parent: { id: 'root-id', tagName: 'Root' },
					attributes: { aA: 'X' },
				},
				dialecteConfig: config,
			})
			expect(canonical.namespace).toEqual(config.definition.A.namespace)
		})

		it('falls back to the element namespace for a root record with no parent', () => {
			const result = standardizeRecord({
				record: { tagName: 'Root', attributes: {} as any },
				dialecteConfig: config,
			})
			expect(result.namespace).toEqual(config.definition.Root.namespace)
		})
	})
})
