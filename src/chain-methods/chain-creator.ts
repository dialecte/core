import {
	createGetContextMethod,
	createCommitMethod,
	createGetParentMethod,
	createFindChildrenMethod,
	createFindDescendantsMethod,
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

import type { CoreChain, Chain, ChainFactory } from './types'
import type { DatabaseInstance } from '@/database'
import type { Context, AnyDialecteConfig, ElementsOf } from '@/types'

export function createCoreChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	tagName: GenericElement
}): CoreChain<GenericConfig, GenericElement> {
	const { chain, contextPromise, dialecteConfig, databaseInstance } = params

	return {
		//== Navigation
		goToElement: createGoToElementMethod({
			chain,
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		goToParent: createGoToParentMethod({ chain, contextPromise, dialecteConfig, databaseInstance }),
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
		getTree: createGetTreeMethod({
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
		getAttributesValues: createGetAttributesValuesMethod({
			contextPromise,
		}),
		//== Mutations
		addChild: createAddChildMethod({
			chain,
			contextPromise,
			dialecteConfig,
		}),
		deepCloneChild: createDeepCloneChildMethod({
			chain,
			contextPromise,
		}),
		update: createUpdateElementMethod({
			chain,
			contextPromise,
			dialecteConfig,
		}),
		delete: createDeleteElementMethod({
			chain,
			contextPromise,
			dialecteConfig,
			databaseInstance,
		}),
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
}

export function createExtensionChain<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	coreChain: CoreChain<GenericConfig, GenericElement>
	tagName: GenericElement
	chain: ChainFactory
	dialecteConfig: GenericConfig
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
}): Chain<GenericConfig, GenericElement> {
	const { coreChain, tagName, chain, dialecteConfig, contextPromise } = params

	const chainWithExtensions: any = { ...coreChain }
	const elementExtensions = dialecteConfig.extensions[tagName] || {}

	// Attach extension methods by calling each method creator
	for (const [methodName, createMethodFn] of Object.entries(elementExtensions)) {
		chainWithExtensions[methodName] = createMethodFn({
			chain,
			dialecteConfig,
			contextPromise,
		})
	}

	return chainWithExtensions
}
