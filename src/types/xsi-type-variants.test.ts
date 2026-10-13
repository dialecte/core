import { describe, expectTypeOf, it } from 'vitest'

import type { FilterAttributes } from '@/document/query/find/by-attribute/find-by-attributes.types'
import type { AddChildParams } from '@/document/transaction/create/create.types'
import type { TestDialecteConfig } from '@/test/config'
import type {
	AttributesOf,
	AttributesValueObjectOf,
	DefaultAttributeNamesOf,
	DefaultAttributesValueObjectOf,
	FullAttributeObjectOf,
} from '@/types'

// The test dialecte's branch D, as create generates it: DD_1 is abstract (a union of the four types it may take, each
// naming itself in 'xsi:type'), DD_2 concrete (its own member, 'xsi:type' naming tDD_2 or absent, beside tDD_2A),
// DDD_2 of xs:anyType (an own member naming no type, beside every type of the schema); A takes no other type.
type Config = TestDialecteConfig

// what an object literal is checked as, where TypeScript refuses a key no member has (assignability alone allows it)
function asFilter(filter: FilterAttributes<Config, 'DD_1'>): unknown {
	return filter
}
function asWritten<Element extends 'DD_1' | 'DD_2'>(
	_element: Element,
	attributes: DefaultAttributesValueObjectOf<Config, Element>,
): unknown {
	return attributes
}

describe('xsi:type variants: the names and values of a union', () => {
	it('the attribute names -> those of every member, not only those all share', () => {
		expectTypeOf<AttributesOf<Config, 'DD_2'>>().toEqualTypeOf<
			'aDD_2' | 'bDD_2' | 'ext:cDD_2' | 'xsi:type' | 'dDD_2'
		>()
		expectTypeOf<DefaultAttributeNamesOf<Config, 'DD_2'>>().toEqualTypeOf<
			'aDD_2' | 'bDD_2' | 'dDD_2'
		>()
	})

	it('a full attribute object -> each name with its value, across members', () => {
		type Named = Extract<FullAttributeObjectOf<Config, 'DD_2'>, { name: 'xsi:type' }>
		expectTypeOf<Named['value']>().toEqualTypeOf<'tDD_2' | 'tDD_2A' | undefined>()
	})

	it("a type's attribute -> read once 'xsi:type' names it", () => {
		const attributes = {} as AttributesValueObjectOf<Config, 'DD_2'>
		if (attributes['xsi:type'] === 'tDD_2A') {
			expectTypeOf(attributes.dDD_2).toEqualTypeOf<string | undefined>()
		}
		const anything = {} as AttributesValueObjectOf<Config, 'DDD_2'>
		if (anything['xsi:type'] === 'tDD_2A') expectTypeOf(anything.aDD_2).toEqualTypeOf<string>()
	})

	it('an element taking no other type -> its attributes, as ever', () => {
		expectTypeOf<AttributesOf<Config, 'A'>>().toEqualTypeOf<'aA' | 'bA' | 'ext:cA'>()
	})
})

describe('xsi:type variants: filters', () => {
	type Filter = FilterAttributes<Config, 'DD_1'>

	it('an attribute without a type, or with one -> accepted', () => {
		expectTypeOf<{ aDD_1: 'x' }>().toExtend<Filter>()
		expectTypeOf<{ dDD_1: 'x' }>().toExtend<Filter>()
		expectTypeOf<{ 'xsi:type': 'tDD_1A'; dDD_1: 'x' }>().toExtend<Filter>()
		expectTypeOf<{ 'xsi:type': ('tDD_1A' | 'ext:tDD_1C')[] }>().toExtend<Filter>()
		// a type held in a variable of several: each one it may be
		expectTypeOf<{ 'xsi:type': 'tDD_1A' | 'tDD_1B'; aDD_1: 'x' }>().toExtend<Filter>()
	})

	it('an attribute the named type does not have, a type the element may not take -> refused', () => {
		// @ts-expect-error dDD_1 is no attribute of tDD_1B
		asFilter({ 'xsi:type': 'tDD_1B', dDD_1: 'x' })
		// @ts-expect-error DD_1 may not take tDD_2A
		asFilter({ 'xsi:type': 'tDD_2A' })
		// by its type, not only as an object literal: another member's attribute is `never` there
		expectTypeOf<{ 'xsi:type': 'tDD_1B'; dDD_1: 'x' }>().not.toExtend<Filter>()
	})
})

describe('xsi:type variants: writes', () => {
	type Written<Element extends 'DD_1' | 'DD_2'> = DefaultAttributesValueObjectOf<Config, Element>

	it("an abstract type -> its type named, with that type's attributes", () => {
		expectTypeOf<{ 'xsi:type': 'tDD_1A'; aDD_1: 'x'; dDD_1: 'y' }>().toExtend<Written<'DD_1'>>()
		expectTypeOf<{ aDD_1: 'x' }>().not.toExtend<Written<'DD_1'>>()
		expectTypeOf<{ 'xsi:type': 'tDD_1A'; aDD_1: 'x' }>().not.toExtend<Written<'DD_1'>>()
	})

	it('a concrete type -> its own attributes without a type, or another type named', () => {
		expectTypeOf<{ aDD_2: 'x' }>().toExtend<Written<'DD_2'>>()
		expectTypeOf<{ 'xsi:type': 'tDD_2'; aDD_2: 'x' }>().toExtend<Written<'DD_2'>>()
		expectTypeOf<{ 'xsi:type': 'tDD_2A'; aDD_2: 'x'; dDD_2: 'y' }>().toExtend<Written<'DD_2'>>()
		// @ts-expect-error dDD_2 is tDD_2A's: a write giving it names that type
		asWritten('DD_2', { aDD_2: 'x', dDD_2: 'y' })
	})

	it('addChild of an abstract child -> its attributes required: an instance names its type', () => {
		expectTypeOf<AddChildParams<Config, 'D', 'DD_1'>>().toHaveProperty('attributes')
		expectTypeOf<{ tagName: 'DD_1' }>().not.toExtend<AddChildParams<Config, 'D', 'DD_1'>>()
	})
})
