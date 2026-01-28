import { GoToElementParams } from '@/chain-methods/navigation'

import type { AddChildParams, UpdateElementParams } from '@/chain-methods/mutations'
import type { AnyDialecteConfig, ElementsOf, ChildrenOf } from '@/types'

export type ChainTestOperation<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	| ({
			type: 'update'
			goTo: GoToElementParams<GenericConfig, GenericElement>
	  } & UpdateElementParams<GenericConfig, GenericElement>)
	| {
			type: 'delete'
			goTo: GoToElementParams<GenericConfig, GenericElement>
	  }
	| ({
			type: 'addChild'
			goTo?: GoToElementParams<GenericConfig, GenericElement>
	  } & AddChildParams<GenericConfig, GenericElement, GenericChildElement>)
