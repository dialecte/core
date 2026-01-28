import {
	FindChildrenParams,
	GetTreeParams,
	DescendantsFilter,
	FindDescendantsReturn,
} from './ending/queries'

import type {
	AddChildParamsWithFocus,
	AddChildParamsWithoutFocus,
	UpdateElementParams,
	DeepCloneChildWithFocusParams,
	DeepCloneChildWithoutFocusParams,
} from './mutations'
import type { GoToElementParams } from './navigation'
import type {
	Context,
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	ParentsOf,
	ExtensionRegistry,
	ChainRecord,
	TreeRecord,
} from '@/types'

export type CoreChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	//==================== NAVIGATION ===================

	goToElement<GenericTargetElement extends ElementsOf<GenericConfig>>(
		params: GoToElementParams<GenericConfig, GenericTargetElement>,
	): Chain<GenericConfig, GenericTargetElement>

	goToParent<GenericParentElement extends ParentsOf<GenericConfig, GenericElement>>(): Chain<
		GenericConfig,
		GenericParentElement
	>

	//===================== QUERIES =====================

	findChildren<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: FindChildrenParams<GenericConfig, GenericElement, GenericChild>,
	): Promise<Record<GenericChild, ChainRecord<GenericConfig, GenericChild>[]>>

	findDescendants(): FindDescendantsReturn<GenericConfig, undefined, GenericElement>

	findDescendants<GenericFilter extends DescendantsFilter<GenericConfig>>(
		filter: GenericFilter,
	): FindDescendantsReturn<GenericConfig, GenericFilter, GenericElement>

	getTree(
		params?: GetTreeParams<GenericConfig, GenericElement>,
	): Promise<TreeRecord<GenericConfig, GenericElement>>
	//==================== MUTATIONS ====================

	/**
	 * Create child element with setFocus: true - narrows to child element type
	 */
	addChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: AddChildParamsWithFocus<GenericConfig, GenericElement, GenericChild>,
	): Chain<GenericConfig, GenericChild>

	/**
	 * Create child element with setFocus: false - stays on current element
	 */
	addChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: AddChildParamsWithoutFocus<GenericConfig, GenericElement, GenericChild>,
	): Chain<GenericConfig, GenericElement>

	/**
	 * Deep clone child element with setFocus: true - narrows to child element type
	 */
	deepCloneChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildWithFocusParams<GenericConfig, GenericChild>,
	): Chain<GenericConfig, GenericChild>

	/**
	 * Deep clone child element with setFocus: false - stays on current element
	 */
	deepCloneChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildWithoutFocusParams<GenericConfig, GenericChild>,
	): Chain<GenericConfig, GenericElement>

	update(
		params: UpdateElementParams<GenericConfig, GenericElement>,
	): Chain<GenericConfig, GenericElement>

	delete(): Chain<GenericConfig, ParentsOf<GenericConfig, GenericElement>>

	//==================== ENDINGS ====================

	getContext(): Promise<Context<GenericConfig, GenericElement>>
	getParent(): Promise<ChainRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>>
	commit(): Promise<void>
}

/**
 * Extract extension methods from mapped object
 */
type ExtractExtensionMethods<T> = {
	[K in keyof T]: T[K] extends (params: any) => infer Method ? Method : never
}

/**
 * Extension methods for a specific element from the extension registry
 */
type ExtensionMethods<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig extends { extensions: ExtensionRegistry<GenericConfig> }
	? GenericConfig['extensions'][GenericElement] extends Record<string, any>
		? ExtractExtensionMethods<GenericConfig['extensions'][GenericElement]>
		: {}
	: {}

/**
 * Complete chain with core and extensions methods
 */
export type Chain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = CoreChain<GenericConfig, GenericElement> & ExtensionMethods<GenericConfig, GenericElement>

export type ChainFactory = <
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
}) => Chain<GenericConfig, GenericElement>

export type AnyChain = Chain<AnyDialecteConfig, ElementsOf<AnyDialecteConfig>>
