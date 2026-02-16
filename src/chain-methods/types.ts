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
	DeleteElementParams,
} from './mutations'
import type { GoToElementParams, GoToParentParams } from './navigation'
import type {
	Context,
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	ParentsOf,
	ExtensionRegistry,
	ChainRecord,
	TreeRecord,
	FullAttributeObjectOf,
} from '@/types'

export type CoreChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
> = {
	//==================== NAVIGATION ===================

	goToElement<GenericTargetElement extends ElementsOf<GenericConfig>>(
		params: GoToElementParams<GenericConfig, GenericTargetElement>,
	): Chain<GenericConfig, GenericTargetElement, GenericExtensionRegistry>

	goToParent: GenericElement extends GenericConfig['rootElementName']
		? never
		: <GenericParentElement extends ParentsOf<GenericConfig, GenericElement>>(
				params: GoToParentParams<GenericConfig, GenericElement, GenericParentElement>,
			) => Chain<GenericConfig, GenericParentElement, GenericExtensionRegistry>

	//===================== QUERIES =====================

	findChildren<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: FindChildrenParams<GenericConfig, GenericElement, GenericChild>,
	): Promise<Record<GenericChild, ChainRecord<GenericConfig, GenericChild>[]>>

	findDescendants<GenericFilter extends DescendantsFilter<GenericConfig> | undefined = undefined>(
		filter?: GenericFilter,
	): FindDescendantsReturn<GenericConfig, GenericFilter, GenericElement>

	findDescendantsAsTree<GenericFilter extends DescendantsFilter<GenericConfig>>(
		filter: GenericFilter,
	): Promise<TreeRecord<GenericConfig, GenericFilter['tagName']>[]>

	getTree(
		params?: GetTreeParams<GenericConfig, GenericElement>,
	): Promise<TreeRecord<GenericConfig, GenericElement>>

	getAttributesValues<
		GenericAttribute extends FullAttributeObjectOf<GenericConfig, GenericElement>,
	>(): Promise<Record<GenericAttribute['name'], GenericAttribute['value']>>

	//==================== MUTATIONS ====================

	/**
	 * Create child element with setFocus: true - narrows to child element type
	 */
	addChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: AddChildParamsWithFocus<GenericConfig, GenericElement, GenericChild>,
	): Chain<GenericConfig, GenericChild, GenericExtensionRegistry>

	/**
	 * Create child element with setFocus: false - stays on current element
	 */
	addChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: AddChildParamsWithoutFocus<GenericConfig, GenericElement, GenericChild>,
	): Chain<GenericConfig, GenericElement, GenericExtensionRegistry>

	/**
	 * Deep clone child element with setFocus: true - narrows to child element type
	 */
	deepCloneChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildWithFocusParams<GenericConfig, GenericChild>,
	): Chain<GenericConfig, GenericChild, GenericExtensionRegistry>

	/**
	 * Deep clone child element with setFocus: false - stays on current element
	 */
	deepCloneChild<GenericChild extends ChildrenOf<GenericConfig, GenericElement>>(
		params: DeepCloneChildWithoutFocusParams<GenericConfig, GenericChild>,
	): Chain<GenericConfig, GenericElement, GenericExtensionRegistry>

	update(
		params: UpdateElementParams<GenericConfig, GenericElement>,
	): Chain<GenericConfig, GenericElement, GenericExtensionRegistry>

	delete: GenericElement extends GenericConfig['rootElementName']
		? never
		: <GenericParentElement extends ParentsOf<GenericConfig, GenericElement>>(
				params: DeleteElementParams<GenericConfig, GenericElement, GenericParentElement>,
			) => Chain<GenericConfig, GenericParentElement, GenericExtensionRegistry>

	//==================== ENDINGS ====================

	getContext(): Promise<Context<GenericConfig, GenericElement>>
	getParent(): Promise<ChainRecord<GenericConfig, ParentsOf<GenericConfig, GenericElement>>>
	commit(): Promise<void>
}

/**
 * Extract extension methods from mapped object
 */
type ExtractExtensionMethods<GenericMethod> = {
	[K in keyof GenericMethod]: GenericMethod[K] extends (params: any) => infer Method
		? Method
		: never
}

/**
 * Extension methods for a specific element from the extension registry
 */
export type ExtensionChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
> = ExtractExtensionMethods<GenericExtensionRegistry[GenericElement]>

/**
 * Complete chain with core and extensions methods
 */
export type Chain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
> = CoreChain<GenericConfig, GenericElement, GenericExtensionRegistry> &
	ExtensionChain<GenericConfig, GenericElement, GenericExtensionRegistry>

/**
 * Chain factory with bound Config and Registry - only Element varies per call.
 * Matches the implementation's closure-based structure where Config and Registry
 * are captured from the outer scope.
 */
export type ChainFactory<
	GenericConfig extends AnyDialecteConfig,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
> = <GenericFocusedElement extends ElementsOf<GenericConfig>>(params: {
	contextPromise: Promise<Context<GenericConfig, GenericFocusedElement>>
	newFocusedTagName?: GenericFocusedElement
}) => Chain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>

export type AnyChain = Chain<
	AnyDialecteConfig,
	ElementsOf<AnyDialecteConfig>,
	ExtensionRegistry<AnyDialecteConfig>
>
