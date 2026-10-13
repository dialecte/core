import { describe, expectTypeOf, it } from 'vitest'

import type { FilterAttributes } from '@/document/query/find/by-attribute/find-by-attributes.types'
import type { ChildAttributesOf } from '@/document/transaction/create/create.types'
import type { TestDialecteConfig } from '@/test/config'
import type { AttributesValueObjectOf, DefaultAttributeNamesOf, ElementsOf } from '@/types'

type Config = TestDialecteConfig

// what an object literal is checked as, where TypeScript refuses a key the type has not
// a value object is a filter, in code generic over the element too (a value read once, matched again)
function asFilter<Element extends ElementsOf<Config>>(
	attributes: AttributesValueObjectOf<Config, Element>,
): FilterAttributes<Config, Element> {
	return attributes
}

function asChildAttributes(attributes: ChildAttributesOf<Config, 'AA_1'>): unknown {
	return attributes
}

describe('the value object: every attribute under the name it is stored by', () => {
	it('a read and a write -> the same object, a namespaced attribute prefixed', () => {
		expectTypeOf<{ aAA_1: 'x'; 'ext:cAA_1': 'y' }>().toExtend<
			AttributesValueObjectOf<Config, 'AA_1'>
		>()
		expectTypeOf<{ aAA_1: 'x'; 'ext:cAA_1': 'y' }>().toExtend<ChildAttributesOf<Config, 'AA_1'>>()
	})

	it('a prefix the dialecte has no attribute under -> refused', () => {
		// @ts-expect-error no attribute nope:cAA_1
		asChildAttributes({ aAA_1: 'x', 'nope:cAA_1': 'y' })
	})

	it('the array form names a default-namespace attribute without a namespace -> no prefixed name', () => {
		expectTypeOf<DefaultAttributeNamesOf<Config, 'AA_1'>>().toEqualTypeOf<'aAA_1' | 'bAA_1'>()
	})

	it('a value object -> a filter of the same element, generically too', () => {
		expectTypeOf(asFilter<'AA_1'>).returns.toEqualTypeOf<FilterAttributes<Config, 'AA_1'>>()
	})
})
