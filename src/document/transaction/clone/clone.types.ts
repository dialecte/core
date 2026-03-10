import type { AnyDialecteConfig, ElementsOf, Ref } from '@/types'

/**
 * Mapping of source to target refs during cloning operations.
 */
export type CloneMapping<GenericConfig extends AnyDialecteConfig> = {
	source: Ref<GenericConfig, ElementsOf<GenericConfig>>
	target: Ref<GenericConfig, ElementsOf<GenericConfig>>
}

/**
 * Result of a deepClone operation.
 */
export type CloneResult<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	ref: Ref<GenericConfig, GenericElement>
	mappings: CloneMapping<GenericConfig>[]
}
