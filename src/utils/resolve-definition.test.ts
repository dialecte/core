import { getAttributeRules, resolveSchemaAttributeValue } from './attribute-rules'
import { resolveDefinition } from './resolve-definition'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

// A homonym on the test system: AAA_1 declared twice, with a required `aAAA_1` and an AAAA_1 child
// under AA_1, as a bare text under AA_2. The tag-level definition is the union; each parent's edge
// carries what AAA_1 holds as declared there, next to its occurrence.
const none = { prefix: '', uri: '' }
const underAa1 = {
	attributes: {
		sequence: ['bAAA_1', 'aAAA_1'],
		details: { bAAA_1: {}, aAAA_1: { required: true as const } },
	},
	children: {
		sequence: ['AAAA_1'],
		details: { AAAA_1: { required: true as const, minOccurs: 1, maxOccurs: 1 } },
	},
}
const underAa2 = {
	attributes: { sequence: [], details: {} },
	children: { sequence: [], details: {} },
	textContent: {},
}
const config = {
	...TEST_DIALECTE_CONFIG,
	definition: {
		...TEST_DIALECTE_CONFIG.definition,
		AA_1: {
			tag: 'AA_1',
			namespace: none,
			parents: [],
			attributes: { sequence: [], details: {} },
			children: {
				sequence: ['AAA_1'],
				details: { AAA_1: { required: true, minOccurs: 1, maxOccurs: 1, ...underAa1 } },
			},
		},
		AA_2: {
			tag: 'AA_2',
			namespace: none,
			parents: [],
			attributes: { sequence: [], details: {} },
			children: { sequence: ['AAA_1'], details: { AAA_1: { maxOccurs: 1, ...underAa2 } } },
		},
		AAA_1: {
			tag: 'AAA_1',
			namespace: none,
			parents: ['AA_1', 'AA_2'],
			// the union: aAAA_1 is no longer required, since the AAA_1 under AA_2 has none
			attributes: {
				sequence: ['bAAA_1', 'aAAA_1'],
				details: { bAAA_1: {}, aAAA_1: { default: 'x' } },
			},
			children: { sequence: ['AAAA_1'], details: { AAAA_1: {} } },
			// the union keeps the text of the declaration under AA_2
			textContent: {},
			constraints: [{ kind: 'unique', name: 'uniqueAAAA_1', selector: [], fields: [] }],
		},
	},
} as unknown as AnyDialecteConfig

const under = (parentTagName: string | null) => ({
	tagName: 'AAA_1',
	parent: parentTagName === null ? null : { id: `${parentTagName}-1`, tagName: parentTagName },
})

describe('resolveDefinition', () => {
	it('takes what the element holds from the edge when the parent declares it there', () => {
		const aa1 = resolveDefinition({ dialecteConfig: config, record: under('AA_1') })
		expect(aa1?.attributes).toBe(underAa1.attributes)
		expect(aa1?.children).toBe(underAa1.children)
		const aa2 = resolveDefinition({ dialecteConfig: config, record: under('AA_2') })
		expect(aa2?.attributes).toBe(underAa2.attributes)
		expect(aa2?.textContent).toBe(underAa2.textContent)
	})

	it('never mixes a declaration with the union: a field the declaration lacks stays absent', () => {
		const aa1 = resolveDefinition({ dialecteConfig: config, record: under('AA_1') })
		expect(aa1?.textContent).toBeUndefined() // the union has text; the AA_1 declaration has none
	})

	it('keeps what is the same everywhere from the tag level, and no occurrence of the edge', () => {
		const aa1 = resolveDefinition({ dialecteConfig: config, record: under('AA_1') })
		const tagLevel = config.definition.AAA_1
		expect(aa1?.tag).toBe('AAA_1')
		expect(aa1?.parents).toBe(tagLevel.parents)
		expect(aa1?.constraints).toBe(tagLevel.constraints)
		expect(aa1).not.toHaveProperty('minOccurs')
		expect(aa1).not.toHaveProperty('required')
	})

	it('is the tag-level definition for a root, or a parent with no definition for it', () => {
		const tagLevel = config.definition.AAA_1
		expect(resolveDefinition({ dialecteConfig: config, record: under(null) })).toBe(tagLevel)
		expect(resolveDefinition({ dialecteConfig: config, record: under('Root') })).toBe(tagLevel)
		expect(
			resolveDefinition({
				dialecteConfig: config,
				record: { tagName: 'A', parent: { id: 'root-1', tagName: 'Root' } },
			}),
		).toBe(config.definition.A)
	})

	it('is undefined for a tag the dialecte does not know', () => {
		expect(
			resolveDefinition({
				dialecteConfig: config,
				record: { tagName: 'nope', parent: { id: 'root-1', tagName: 'Root' } },
			}),
		).toBeUndefined()
	})

	it('refuses a ref: it carries no parent, so it would silently read the union', () => {
		const ref = { tagName: 'AAA_1', id: 'aaa1-1' }
		// @ts-expect-error a ref is resolved to its record first, with query.getDefinition(ref)
		resolveDefinition({ dialecteConfig: config, record: ref })
	})
})

describe('attribute rules read the definition of the edge', () => {
	it('an attribute required under one parent only is required there, and only there', () => {
		const rules = (parentTagName: string | null) =>
			getAttributeRules({
				dialecteConfig: config,
				record: under(parentTagName),
				attributeName: 'aAAA_1',
			})
		expect(rules('AA_1').isRequired).toBe(true)
		expect(rules('AA_2').isDefined).toBe(false)
		expect(rules(null).isRequired).toBe(false) // the union: what any declaration accepts
	})

	it('a default of the union view is not injected where the definition has no such attribute', () => {
		const value = (parentTagName: string | null) =>
			resolveSchemaAttributeValue({
				dialecteConfig: config,
				record: under(parentTagName),
				attributeName: 'aAAA_1',
				defaults: 'optional',
			})
		expect(value(null)).toBe('x')
		expect(value('AA_2')).toBeUndefined()
	})
})
