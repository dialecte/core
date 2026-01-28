import { createCoreChain, createExtensionChain } from './chain-creator'

import type { Chain, ChainFactory } from './types'
import type { DatabaseInstance } from '@/database'
import type { Context, AnyDialecteConfig, ElementsOf } from '@/types'

export function chain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	tagName: GenericElement
}): Chain<GenericConfig, GenericElement> {
	const { dialecteConfig, databaseInstance, contextPromise, tagName } = params
	// Bound chain factory for core methods
	function chainFactory(params: {
		contextPromise: Promise<Context<GenericConfig, GenericElement>>
	}): Chain<GenericConfig, GenericElement> {
		const { contextPromise } = params

		return chain<GenericConfig, GenericElement>({
			dialecteConfig,
			databaseInstance,
			contextPromise: contextPromise,
			tagName: tagName,
		})
	}

	const coreChain = createCoreChain({
		chain: chainFactory as ChainFactory,
		dialecteConfig,
		databaseInstance,
		contextPromise,
		tagName,
	})

	// const extensionRegistry = dialecteConfig.extensions || {}

	return createExtensionChain<GenericConfig, GenericElement>({
		coreChain,
		tagName,
		chain: chainFactory as ChainFactory,
		dialecteConfig,
		contextPromise,
	})
}
