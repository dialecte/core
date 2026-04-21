import type { AnyAttribute, AnyDialecteConfig, ElementsOf, RawRecord, Ref } from '@/types'

/**
 * Mapping of source to target refs during cloning operations.
 * source carries the original record's attributes so hooks can
 * recover source-side data without querying across databases.
 */
export type CloneMapping<GenericConfig extends AnyDialecteConfig> = {
	source: Ref<GenericConfig, ElementsOf<GenericConfig>> & {
		attributes: readonly AnyAttribute[]
	}
	target: Ref<GenericConfig, ElementsOf<GenericConfig>>
}

/**
 * Result of a deepClone operation.
 */
export type CloneResult<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	record: RawRecord<GenericConfig, GenericElement>
	mappings: CloneMapping<GenericConfig>[]
}
