import type {
	AnyDialecteConfig,
	AttributesOf,
	AttributesValueObjectOf,
	ChainRecord,
	ElementsOf,
} from '@/types'

export type Scope = 'global' | 'ancestors' | 'descendants' | 'children'

export type FilterAttributes<
	GenericVersion extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericVersion>,
> = {
	[K in AttributesOf<GenericVersion, GenericElement>]?:
		| AttributesValueObjectOf<GenericVersion, GenericElement>[K]
		| Array<AttributesValueObjectOf<GenericVersion, GenericElement>[K]>
}

// Type for grouped records preserving tagName unions
export type GroupedRecordsByTagName<
	GenericConfig extends AnyDialecteConfig,
	GenericRecords extends readonly ChainRecord<GenericConfig, any>[],
> = {
	[K in GenericRecords[number]['tagName']]?: Extract<GenericRecords[number], { tagName: K }>[]
}
