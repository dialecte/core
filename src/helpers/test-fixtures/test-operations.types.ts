import { GoToElementParams } from '@/chain-methods/navigation'

import type { AddChildParams, UpdateElementParams } from '@/chain-methods/mutations'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf } from '@/types'

export type ChainTestOperation<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
> =
	| ({
			type: 'update'
			goTo?: GoToElementParams<GenericConfig, GenericElement>
	  } & UpdateElementParams<GenericConfig, GenericElement>)
	| {
			type: 'delete'
			goTo?: GoToElementParams<GenericConfig, GenericElement>
	  }
	| ({
			type: 'addChild'
			goTo?: GoToElementParams<GenericConfig, GenericElement>
	  } & AddChildParams<GenericConfig, GenericElement, GenericChildElement>)

export type AnyChainTestOperation = ChainTestOperation<
	AnyDialecteConfig,
	ElementsOf<AnyDialecteConfig>,
	ChildrenOf<AnyDialecteConfig, ElementsOf<AnyDialecteConfig>>
>

/**
 * For table-driven tests where operations can target any element in the config.
 * This creates a distributive union that maintains proper type narrowing for each operation.
 */
export type AnyElementChainTestOperation<GenericConfig extends AnyDialecteConfig> =
	ElementsOf<GenericConfig> extends infer Element
		? Element extends ElementsOf<GenericConfig>
			? ChainTestOperation<GenericConfig, Element, ChildrenOf<GenericConfig, Element>>
			: never
		: never
