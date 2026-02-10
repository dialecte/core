import { createCoreChain, createExtensionChain } from './chain-creator'

import type { Chain } from './types'
import type { DatabaseInstance } from '@/database'
import type { Context, AnyDialecteConfig, ElementsOf, ExtensionRegistry } from '@/types'

export function chain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	extensions: GenericExtensionRegistry
	focusedTagName: GenericElement
}): Chain<GenericConfig, GenericElement, GenericExtensionRegistry> {
	const { dialecteConfig, databaseInstance, contextPromise, extensions, focusedTagName } = params
	// Bound chain factory for core methods
	function chainFactory<
		GenericFocusedElement extends ElementsOf<GenericConfig> = GenericElement,
	>(params: {
		contextPromise: Promise<Context<GenericConfig, GenericFocusedElement>>
		newFocusedTagName?: GenericFocusedElement
	}): Chain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry> {
		const { contextPromise, newFocusedTagName = focusedTagName } = params

		return chain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>({
			dialecteConfig,
			databaseInstance,
			contextPromise: contextPromise,
			extensions,
			focusedTagName: newFocusedTagName as GenericFocusedElement,
		})
	}

	const coreChain = createCoreChain<GenericConfig, GenericElement, GenericExtensionRegistry>({
		chain: chainFactory,
		dialecteConfig,
		databaseInstance,
		contextPromise,
		focusedTagName,
	})

	// const extensionRegistry = dialecteConfig.extensions || {}

	const extensionChain = createExtensionChain<
		GenericConfig,
		GenericElement,
		GenericExtensionRegistry
	>({
		focusedTagName,
		extensions,
		chain: chainFactory,
		dialecteConfig,
		contextPromise,
	})

	return {
		...coreChain,
		...extensionChain,
	}
}
