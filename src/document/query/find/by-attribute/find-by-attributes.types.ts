import type { AnyDialecteConfig, AttributesValueObjectOf, ElementsOf } from '@/types'

/**
 * What `findByAttributes` matches an element's attributes against: each attribute a value or any of several. For an
 * element that may take another type with `xsi:type`, one filter per member of its type - an attribute of a named type
 * only with that type, or with no type named: any member having it - and one naming several types.
 */
export type FilterAttributes<
	GenericVersion extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericVersion>,
> =
	| MemberFiltersOf<AttributesValueObjectOf<GenericVersion, GenericElement>>
	| SeveralTypesFilterOf<AttributesValueObjectOf<GenericVersion, GenericElement>>

/** One filter per member: a mapped type over a type parameter is one per member of a union. */
type MemberFiltersOf<GenericAttributes> = {
	[K in keyof GenericAttributes]?: K extends 'xsi:type'
		? GenericAttributes[K]
		: GenericAttributes[K] | Array<GenericAttributes[K]>
}

/**
 * Several types named at once: the attributes any of them has - every member lists every key of the union, so a key
 * reads the values of all. Mapped over the keys as strings, not over the union: that would be one per member.
 */
type SeveralTypesFilterOf<GenericAttributes> = {
	[K in keyof GenericAttributes & string]?: K extends 'xsi:type'
		? Array<NonNullable<GenericAttributes[K]>>
		: GenericAttributes[K] | Array<GenericAttributes[K]>
}
