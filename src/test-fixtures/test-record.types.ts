import type {
	AnyDialecteConfig,
	ElementsOf,
	FullAttributeObjectOf,
	RawRecord,
	AttributesValueObjectOf,
} from '@/types'

export type TestRecord<Config extends AnyDialecteConfig> = {
	[E in ElementsOf<Config>]: {
		tagName: E
		attributes?: AttributesValueObjectOf<Config, E> | FullAttributeObjectOf<Config, E>[]
	} & Omit<Partial<RawRecord<Config, E>>, 'attributes'>
}[ElementsOf<Config>]
