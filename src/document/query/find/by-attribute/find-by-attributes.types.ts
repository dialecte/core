import type { AnyDialecteConfig, AttributesOf, AttributesValueObjectOf, ElementsOf } from '@/types'

/**
 * What `findByAttributes` matches an element's attributes against: each attribute a value or any of several. For an
 * element that may take another type with `xsi:type`, one filter per member of its type - an attribute of a named type
 * only with that type, or with no type named: any member having it - and one naming several types. Any part of the
 * element's value object is a filter too: what code generic over the element reads, it matches again.
 */
export type FilterAttributes<
	GenericVersion extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericVersion>,
> =
	'xsi:type' extends AttributesOf<GenericVersion, GenericElement>
		? MemberFiltersFor<AttributesValueObjectOf<GenericVersion, GenericElement>>
		: {
				[K in AttributesOf<GenericVersion, GenericElement>]?:
					| AttributesValueObjectOf<GenericVersion, GenericElement>[K]
					| Array<AttributesValueObjectOf<GenericVersion, GenericElement>[K]>
			}

/** An element that may take another type: a filter per member, any part of a member, or several types named. */
type MemberFiltersFor<GenericAttributes> =
	| Partial<GenericAttributes>
	| MemberFiltersOf<GenericAttributes>
	| SeveralTypesFilterOf<GenericAttributes>

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
