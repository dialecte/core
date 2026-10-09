import { getAttributeRules, resolveSchemaAttributeValue } from './attribute-rules'
import { resolveDefinition } from './resolve-definition'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { ResolvableRecord } from './resolve-definition.types'
import type { AnyDialecteConfig, AnyTypes, ContentDefinition, DeclarationDefinition } from '@/types'

const XSI = 'http://www.w3.org/2001/XMLSchema-instance'
const none = { prefix: '', uri: '' }
const other = { prefix: 'o', uri: 'urn:other' }
const empty: ContentDefinition = {
	attributes: { sequence: [], details: {} },
	children: { sequence: [], details: {} },
}
const holding = (details: ContentDefinition['children']['details'], any?: true) => ({
	tag: 'Holder',
	namespace: none,
	parents: [],
	attributes: { sequence: [], details: {} },
	children: { sequence: Object.keys(details), details, ...(any ? { any } : {}) },
})

// AAA_1 declared two ways: the first requires aAAA_1 and holds AAAA_1, the second - the global one, in another
// namespace - holds text and admits a type with xsi:type. The tag level is their union.
const first: DeclarationDefinition = {
	namespace: none,
	attributes: {
		sequence: ['bAAA_1', 'aAAA_1'],
		details: { bAAA_1: {}, aAAA_1: { required: true } },
	},
	children: { sequence: ['AAAA_1'], details: {} },
	constraints: [{ kind: 'unique', name: 'u1', namespace: '', selector: [], fields: [] }],
}
const second: DeclarationDefinition = {
	namespace: other,
	global: true,
	attributes: { sequence: ['bAAA_1'], details: { bAAA_1: {} }, identityFields: ['bAAA_1'] },
	children: { sequence: [], details: {} },
	textContent: {},
	variants: ['{urn:other}tExt', `{${TEST_DIALECTE_CONFIG.namespaces.default.uri}}tDefault`],
	abstractType: true,
}
const tExt: ContentDefinition = {
	attributes: { sequence: ['bAAA_1', 'extra'], details: { bAAA_1: {}, extra: {} } },
	children: { sequence: ['AAAA_1'], details: {} },
}
// a type in the dialecte's default namespace, named without a prefix
const TYPES: AnyTypes = {
	'{urn:other}tExt': tExt,
	[`{${TEST_DIALECTE_CONFIG.namespaces.default.uri}}tDefault`]: tExt,
}

const config = {
	...TEST_DIALECTE_CONFIG,
	namespaces: { ...TEST_DIALECTE_CONFIG.namespaces, other },
	types: TYPES,
	definition: {
		...TEST_DIALECTE_CONFIG.definition,
		AAA_1: {
			tag: 'AAA_1',
			namespace: none,
			parents: ['ByNamespace', 'Positional', 'Wildcard', 'Ways'],
			attributes: { sequence: ['bAAA_1', 'aAAA_1'], details: { bAAA_1: {}, aAAA_1: {} } },
			children: { sequence: ['AAAA_1'], details: {} },
			textContent: {},
			declarations: { '1': first, '2': second },
		},
		ByNamespace: holding({ AAA_1: { declarations: { '': ['1'], 'urn:other': ['2'] } } }),
		OneNamespace: holding({ AAA_1: { declarations: { 'urn:other': ['2'] } } }),
		Positional: holding({ AAA_1: { declarations: { '': ['1', '2'] } } }),
		Wildcard: holding({}, true),
		// a parent declared two ways: its tag level leaves AAA_1 open, each way decides it
		Ways: {
			...holding({ AAA_1: { declarations: { '': ['1'], 'urn:other': ['2'] } } }),
			declarations: {
				'1': {
					...empty,
					namespace: none,
					children: { sequence: ['AAA_1'], details: { AAA_1: { declarations: { '': ['1'] } } } },
				},
				'2': {
					...empty,
					namespace: none,
					children: { sequence: ['AAA_1'], details: { AAA_1: { declarations: { '': ['2'] } } } },
				},
			},
		},
		// a tag declared one way: its tag level, whatever the parent
		One: { ...empty, tag: 'One', namespace: none, parents: [], variants: ['{urn:other}tExt'] },
	},
} as unknown as AnyDialecteConfig
const tagLevel = config.definition.AAA_1

function record(params: {
	parent: string | null
	tagName?: string
	namespace?: { prefix: string; uri: string }
	attributes?: ResolvableRecord['attributes']
}): ResolvableRecord {
	const { parent, tagName = 'AAA_1', namespace, attributes = [] } = params
	return {
		tagName,
		parent: parent === null ? null : { id: `${parent}-1`, tagName: parent },
		attributes,
		...(namespace ? { namespace } : {}),
	}
}
const xsiType = (value: string) => ({
	name: 'xsi:type',
	value,
	namespace: { prefix: 'xsi', uri: XSI },
})

type DeclarationCase = {
	record: ResolvableRecord
	parentDefinition?: DeclarationDefinition
	/** The content resolved: one of the declarations, or the tag level. */
	expected: DeclarationDefinition | 'tag level'
}

const declarationCases: Record<string, DeclarationCase> = {
	"the parent holds the record's namespace one way -> that declaration": {
		record: record({ parent: 'ByNamespace', namespace: other }),
		expected: second,
	},
	'the parent holds it in no namespace one way -> that declaration': {
		record: record({ parent: 'ByNamespace', namespace: none }),
		expected: first,
	},
	'a record without namespace yet, held in one namespace -> that declaration': {
		record: record({ parent: 'OneNamespace' }),
		expected: second,
	},
	'a record without namespace yet, held in two -> the tag level': {
		record: record({ parent: 'ByNamespace' }),
		expected: 'tag level',
	},
	'the parent leaves it to the particle matched -> the tag level': {
		record: record({ parent: 'Positional', namespace: none }),
		expected: 'tag level',
	},
	"a parent declared two ways, its own declaration not given -> its tag level's choice": {
		record: record({ parent: 'Ways', namespace: none }),
		expected: first,
	},
	"a parent's declaration given -> it decides": {
		record: record({ parent: 'Ways', namespace: none }),
		parentDefinition: config.definition.Ways.declarations?.['2'],
		expected: second,
	},
	"a parent's wildcard admits it -> the global declaration of its namespace": {
		record: record({ parent: 'Wildcard', namespace: other }),
		expected: second,
	},
	'a wildcard admitting a namespace no global declaration has -> the tag level': {
		record: record({ parent: 'Wildcard', namespace: none }),
		expected: 'tag level',
	},
	'a root -> the global declaration of its namespace': {
		record: record({ parent: null, namespace: other }),
		expected: second,
	},
}

describe('resolveDefinition - the declaration of a tag declared several ways', () => {
	for (const [name, { record, parentDefinition, expected }] of Object.entries(declarationCases)) {
		it(name, () => {
			const resolved = resolveDefinition({ dialecteConfig: config, record, parentDefinition })
			const content = expected === 'tag level' ? tagLevel : expected
			expect(resolved?.attributes).toBe(content.attributes)
			expect(resolved?.children).toBe(content.children)
			expect(resolved?.constraints).toBe(content.constraints)
			expect(resolved?.namespace).toBe(content.namespace)
			expect(resolved?.abstractType).toBe(content.abstractType)
			// what is the tag's whatever the declaration
			expect(resolved?.tag).toBe('AAA_1')
			expect(resolved?.parents).toBe(tagLevel.parents)
			expect(resolved).not.toHaveProperty('declarations')
		})
	}
})

type TypeCase = {
	record: ResolvableRecord
	/** The attributes resolved: the type's, or the declaration's when xsi:type names none it admits. */
	expected: 'type' | 'declaration'
}

const typeCases: Record<string, TypeCase> = {
	'xsi:type naming a type the declaration admits -> what the type holds': {
		record: record({ parent: 'ByNamespace', namespace: other, attributes: [xsiType('o:tExt')] }),
		expected: 'type',
	},
	'its prefix bound on the record itself, as parsed -> the same type': {
		record: record({
			parent: 'ByNamespace',
			namespace: other,
			attributes: [
				xsiType('x:tExt'),
				{
					name: 'x',
					value: 'urn:other',
					namespace: { prefix: 'xmlns', uri: 'http://www.w3.org/2000/xmlns/' },
				},
			],
		}),
		expected: 'type',
	},
	'its prefix bound on the record itself, as created -> the same type': {
		record: record({
			parent: 'ByNamespace',
			namespace: other,
			attributes: [xsiType('x:tExt'), { name: 'xmlns:x', value: 'urn:other' }],
		}),
		expected: 'type',
	},
	"an unprefixed name -> a type of the dialecte's default namespace": {
		record: record({ parent: 'ByNamespace', namespace: other, attributes: [xsiType('tDefault')] }),
		expected: 'type',
	},
	'xsi:type naming a type the declaration does not admit -> the declaration': {
		record: record({ parent: 'ByNamespace', namespace: other, attributes: [xsiType('o:tOther')] }),
		expected: 'declaration',
	},
	'a type of the dialecte its declaration does not list -> the declaration': {
		record: record({ parent: 'ByNamespace', namespace: none, attributes: [xsiType('o:tExt')] }),
		expected: 'declaration',
	},
	'an unbound prefix -> the declaration': {
		record: record({ parent: 'ByNamespace', namespace: other, attributes: [xsiType('q:tExt')] }),
		expected: 'declaration',
	},
	'type an attribute of no namespace -> not xsi:type': {
		record: record({
			parent: 'ByNamespace',
			namespace: other,
			attributes: [{ name: 'type', value: 'o:tExt' }],
		}),
		expected: 'declaration',
	},
}

describe('resolveDefinition - xsi:type', () => {
	for (const [name, { record, expected }] of Object.entries(typeCases)) {
		it(name, () => {
			const resolved = resolveDefinition({ dialecteConfig: config, record })
			if (expected === 'declaration') {
				const declared = record.namespace?.uri === other.uri ? second : first
				expect(resolved?.attributes).toBe(declared.attributes)
				return
			}
			expect(resolved?.attributes.sequence).toBe(tExt.attributes.sequence)
			expect(resolved?.attributes.details).toBe(tExt.attributes.details)
			expect(resolved?.children).toBe(tExt.children)
			// what the element is stays the declaration's: identity, constraints, namespace; an abstract type was named
			expect(resolved?.attributes.identityFields).toBe(second.attributes.identityFields)
			expect(resolved?.namespace).toBe(other)
			expect(resolved?.variants).toBe(second.variants)
			expect(resolved).not.toHaveProperty('abstractType')
		})
	}

	it('applies where the parent leaves the declaration open, to a type one of the declarations admits', () => {
		const resolved = resolveDefinition({
			dialecteConfig: config,
			record: record({ parent: 'Positional', namespace: other, attributes: [xsiType('o:tExt')] }),
		})
		expect(resolved?.children).toBe(tExt.children)
		expect(resolved?.attributes.sequence).toBe(tExt.attributes.sequence)
	})

	it('applies to a tag declared one way too', () => {
		const resolved = resolveDefinition({
			dialecteConfig: config,
			record: record({ parent: null, tagName: 'One', attributes: [xsiType('o:tExt')] }),
		})
		expect(resolved?.children).toBe(tExt.children)
	})
})

describe('resolveDefinition', () => {
	it('is the tag-level definition itself for a tag declared one way, without xsi:type', () => {
		const resolved = resolveDefinition({
			dialecteConfig: config,
			record: record({ parent: 'ByNamespace', tagName: 'One' }),
		})
		expect(resolved).toBe(config.definition.One)
	})

	it('is one object per declaration and type resolved', () => {
		const read = () =>
			resolveDefinition({
				dialecteConfig: config,
				record: record({
					parent: 'ByNamespace',
					namespace: other,
					attributes: [xsiType('o:tExt')],
				}),
			})
		expect(read()).toBe(read())
	})

	it('is undefined for a tag the dialecte does not know', () => {
		expect(
			resolveDefinition({
				dialecteConfig: config,
				record: record({ parent: 'Root', tagName: 'nope' }),
			}),
		).toBeUndefined()
	})

	it('refuses a ref: it carries no parent, so it would silently read the union', () => {
		const ref = { tagName: 'AAA_1', id: 'aaa1-1' }
		// @ts-expect-error a ref is resolved to its record first, with query.getDefinition(ref)
		const fromRef = () => resolveDefinition({ dialecteConfig: config, record: ref })
		expect(fromRef).toBeTypeOf('function')
	})
})

describe('attribute rules read the declaration that applies', () => {
	it('an attribute required by one declaration only is required there, and only there', () => {
		const rules = (parent: string, namespace: { prefix: string; uri: string }) =>
			getAttributeRules({
				dialecteConfig: config,
				record: record({ parent, namespace }),
				attributeName: 'aAAA_1',
			})
		expect(rules('ByNamespace', none).isRequired).toBe(true)
		expect(rules('ByNamespace', other).isDefined).toBe(false)
		expect(rules('Positional', none).isRequired).toBe(false) // the union: what any declaration accepts
	})

	it('a value of the union is not injected where the declaration has no such attribute', () => {
		const defaulted = {
			...config,
			definition: {
				...config.definition,
				AAA_1: {
					...tagLevel,
					attributes: {
						...tagLevel.attributes,
						details: { ...tagLevel.attributes.details, aAAA_1: { default: 'x' } },
					},
				},
			},
		} as AnyDialecteConfig
		const value = (parent: string, namespace: { prefix: string; uri: string }) =>
			resolveSchemaAttributeValue({
				dialecteConfig: defaulted,
				record: record({ parent, namespace }),
				attributeName: 'aAAA_1',
				defaults: 'optional',
			})
		expect(value('Positional', none)).toBe('x')
		expect(value('ByNamespace', other)).toBeUndefined()
	})
})
