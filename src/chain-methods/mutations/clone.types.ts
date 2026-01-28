import type { AnyDialecteConfig, ElementsOf, TreeRecord } from '@/types'

/**
 * DeepCloneChild with setFocus: true - narrows to child element type
 */
export type DeepCloneChildWithFocusParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	record: TreeRecord<GenericConfig, GenericElement>
	setFocus: true
}

/**
 * DeepCloneChild with setFocus: false - stays on current element
 */
export type DeepCloneChildWithoutFocusParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	record: TreeRecord<GenericConfig, GenericElement>
	setFocus: false
}

export type DeepCloneChildParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	| DeepCloneChildWithFocusParams<GenericConfig, GenericElement>
	| DeepCloneChildWithoutFocusParams<GenericConfig, GenericElement>
