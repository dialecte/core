import {
	createGetContextMethod,
	createCommitMethod,
	createGetParentMethod,
	createFindChildrenMethod,
	createFindDescendantsMethod,
	createFindDescendantsAsTreeMethod,
	createGetTreeMethod,
	createGetAttributesValuesMethod,
} from './ending'
import {
	createAddChildMethod,
	createUpdateElementMethod,
	createDeleteElementMethod,
	createDeepCloneChildMethod,
} from './mutations'
import { createGoToElementMethod, createGoToParentMethod } from './navigation'

import type { CoreChain, ChainFactory, ExtensionChain } from './types'
import type { DatabaseInstance } from '@/database'
import type { Context, AnyDialecteConfig, ElementsOf, ExtensionRegistry } from '@/types'

export function createCoreChain<
	GenericConfig extends AnyDialecteConfig,
	GenericFocusedElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> =
		ExtensionRegistry<GenericConfig>,
>(params: {
	chain: ChainFactory<GenericConfig, GenericExtensionRegistry>
	contextPromise: Promise<Context<GenericConfig, GenericFocusedElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	focusedTagName: GenericFocusedElement
}): CoreChain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry> {
	const { chain, contextPromise, dialecteConfig, databaseInstance, focusedTagName } = params

	const coreChain = {
		//== Navigation
		goToElement: createGoToElementMethod<
			GenericConfig,
			GenericFocusedElement,
			GenericExtensionRegistry
		>({
			chain,
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		goToParent: (focusedTagName === dialecteConfig.rootElementName
			? undefined
			: createGoToParentMethod<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>({
					chain,
					contextPromise,
					dialecteConfig,
					databaseInstance,
				})) as CoreChain<
			GenericConfig,
			GenericFocusedElement,
			GenericExtensionRegistry
		>['goToParent'],
		//== Queries
		findChildren: createFindChildrenMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		findDescendants: createFindDescendantsMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		findDescendantsAsTree: createFindDescendantsAsTreeMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		getTree: createGetTreeMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		getAttributesValues: createGetAttributesValuesMethod({
			contextPromise,
		}),
		//== Mutations
		addChild: createAddChildMethod<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>({
			chain,
			contextPromise,
			dialecteConfig,
			focusedTagName,
		}),
		deepCloneChild: createDeepCloneChildMethod<
			GenericConfig,
			GenericFocusedElement,
			GenericExtensionRegistry
		>({
			chain,
			contextPromise,
			dialecteConfig,
			focusedTagName,
		}),
		update: createUpdateElementMethod<
			GenericConfig,
			GenericFocusedElement,
			GenericExtensionRegistry
		>({
			chain,
			contextPromise,
			dialecteConfig,
		}),
		delete: (focusedTagName === dialecteConfig.rootElementName
			? undefined
			: createDeleteElementMethod<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>({
					chain,
					contextPromise,
					dialecteConfig,
					databaseInstance,
				})) as CoreChain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry>['delete'],
		//== Endings
		getContext: createGetContextMethod({
			contextPromise,
		}),
		getParent: createGetParentMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		commit: createCommitMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
	}

	return coreChain
}

export function createExtensionChain<
	GenericConfig extends AnyDialecteConfig,
	GenericFocusedElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
>(params: {
	focusedTagName: GenericFocusedElement
	extensions: GenericExtensionRegistry
	chain: ChainFactory<GenericConfig, GenericExtensionRegistry>
	dialecteConfig: GenericConfig
	contextPromise: Promise<Context<GenericConfig, GenericFocusedElement>>
}): ExtensionChain<GenericConfig, GenericFocusedElement, GenericExtensionRegistry> {
	const { extensions, focusedTagName, chain, dialecteConfig, contextPromise } = params

	const chainWithExtensions: Record<string, (...args: any[]) => any> = {}
	const elementExtensions = extensions[focusedTagName]

	if (elementExtensions) {
		// Attach extension methods by calling each method creator
		for (const [methodName, createMethodFn] of Object.entries(elementExtensions)) {
			chainWithExtensions[methodName] = createMethodFn({
				chain,
				dialecteConfig,
				contextPromise,
			})
		}
	}

	return chainWithExtensions as ExtensionChain<
		GenericConfig,
		GenericFocusedElement,
		GenericExtensionRegistry
	>
}
