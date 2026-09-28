import { describe, expectTypeOf, it } from 'vitest'

import type { AddChildParams } from '@/document/transaction/create/create.types'
import type {
	AnyDialecteConfig,
	AttributesOf,
	AttributesValueObjectOf,
	ElementsOf,
	RawRecord,
} from '@/types'

// A dialecte in miniature, on the names of the test system: AAA_1 has a required `aAAA_1` under
// AA_1 and no attribute under AA_2. The tag-level table is the union of the two;
// `attributes.byParent` holds each declaration under its parent.
type Aaa1 = { aAAA_1?: string; bAAA_1?: string }
type Aaa1UnderAa1 = { aAAA_1: string; bAAA_1?: string }
type Aaa1UnderAa2 = Record<never, never>
type Aa1 = { aAA_1: string }
type Aa2 = Record<never, never>

type Config = AnyDialecteConfig & {
	elements: readonly ['AA_1', 'AA_2', 'AAA_1']
	attributes: {
		byTag: { AA_1: Aa1; AA_2: Aa2; AAA_1: Aaa1 }
		byParent: { AA_1: { AAA_1: Aaa1UnderAa1 }; AA_2: { AAA_1: Aaa1UnderAa2 } }
	}
	children: { AA_1: readonly ['AAA_1']; AA_2: readonly ['AAA_1']; AAA_1: readonly [] }
	parents: { AA_1: readonly []; AA_2: readonly []; AAA_1: readonly ['AA_1', 'AA_2'] }
}

describe('attributes by tag, or as declared under a parent', () => {
	it('names no parent: exactly the tag-level type, for one tag, a union of tags, and all of them', () => {
		expectTypeOf<AttributesValueObjectOf<Config, 'AAA_1'>>().toEqualTypeOf<Aaa1>()
		expectTypeOf<AttributesValueObjectOf<Config, 'AA_1' | 'AA_2'>>().toEqualTypeOf<Aa1 | Aa2>()
		expectTypeOf<AttributesOf<Config, 'AA_1' | 'AAA_1'>>().toEqualTypeOf<never>()
		expectTypeOf<AttributesValueObjectOf<Config, ElementsOf<Config>>>().toEqualTypeOf<
			Aa1 | Aa2 | Aaa1
		>()
	})

	it('names a parent: the declaration under that parent', () => {
		expectTypeOf<AttributesValueObjectOf<Config, 'AAA_1', 'AA_1'>>().toEqualTypeOf<Aaa1UnderAa1>()
		expectTypeOf<AttributesValueObjectOf<Config, 'AAA_1', 'AA_2'>>().toEqualTypeOf<Aaa1UnderAa2>()
		expectTypeOf<AttributesOf<Config, 'AAA_1', 'AA_1'>>().toEqualTypeOf<'aAAA_1' | 'bAAA_1'>()
	})

	it('keeps the records assignable up the element hierarchy (variance)', () => {
		expectTypeOf<RawRecord<Config, 'AAA_1'>>().toMatchTypeOf<
			RawRecord<Config, ElementsOf<Config>>
		>()
	})

	it('addChild reads the child as declared under the parent it is added to', () => {
		type UnderAa1 = AddChildParams<Config, 'AA_1', 'AAA_1'>
		type UnderAa2 = AddChildParams<Config, 'AA_2', 'AAA_1'>
		// `aAAA_1` is required under AA_1: `attributes` is mandatory there
		expectTypeOf<UnderAa1>().toHaveProperty('attributes')
		expectTypeOf<
			Extract<UnderAa1['attributes'], { aAAA_1: unknown }>['aAAA_1']
		>().toEqualTypeOf<string>()
		// nothing is declared under AA_2: `attributes` is optional, and `aAAA_1` unknown
		expectTypeOf<
			Extract<NonNullable<UnderAa2['attributes']>, Record<string, unknown>>
		>().not.toHaveProperty('aAAA_1')
	})
})
