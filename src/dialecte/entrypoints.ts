import { resetState } from './state'

import { chain } from '@/chain-methods'
import { assert, toChainRecord } from '@/helpers'

import type { FromElementParams } from './types'
import type { Chain } from '@/chain-methods/types'
import type { DatabaseInstance } from '@/database'
import type {
	Context,
	AnyDialecteConfig,
	RootElementOf,
	ElementsOf,
	ExtensionRegistry,
} from '@/types'

/**
 * Create a chain starting from the root element
 */
export function fromRoot<
	GenericConfig extends AnyDialecteConfig,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
>(params: {
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	extensions: GenericExtensionRegistry
}): Chain<GenericConfig, RootElementOf<GenericConfig>, GenericExtensionRegistry> {
	resetState()

	const { dialecteConfig, databaseInstance, extensions } = params
	const tableName = dialecteConfig.database.tables.xmlElements.name
	const rootElementName = dialecteConfig.rootElementName

	const contextPromise = Promise.resolve().then(
		async (): Promise<Context<GenericConfig, RootElementOf<GenericConfig>>> => {
			const numberOfRootElements = await databaseInstance
				.table(tableName)
				.where({ tagName: rootElementName })
				.count()

			assert(
				numberOfRootElements === 1,
				`Expected exactly one root element "${rootElementName}", found ${numberOfRootElements}`,
			)

			// Fetch the root element
			const rootRecord = await databaseInstance.table(tableName).get({ tagName: rootElementName })

			assert(
				rootRecord,
				`Root element "${rootElementName}" not found in database "${databaseInstance.name}"`,
			)

			const chainRecord = toChainRecord<GenericConfig, RootElementOf<GenericConfig>>({
				record: rootRecord,
			})

			// Return context with root as current focus
			return {
				currentFocus: chainRecord,
				stagedOperations: [],
			}
		},
	)

	return chain<GenericConfig, RootElementOf<GenericConfig>, GenericExtensionRegistry>({
		contextPromise,
		dialecteConfig,
		databaseInstance,
		extensions,
		focusedTagName: rootElementName,
	})
}

/**
 * Create a chain starting from a specific element by tagName and optional id
 */
export function fromElement<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
>(
	params: {
		dialecteConfig: GenericConfig
		databaseInstance: DatabaseInstance<GenericConfig>
		extensions: GenericExtensionRegistry
	} & FromElementParams<GenericConfig, GenericElement>,
): Chain<GenericConfig, GenericElement, GenericExtensionRegistry> {
	resetState()

	const { dialecteConfig, databaseInstance, extensions, tagName, id } = params
	const tableName = dialecteConfig.database.tables.xmlElements.name

	// Create context promise that fetches the specific element
	const contextPromise = Promise.resolve().then(
		async (): Promise<Context<GenericConfig, GenericElement>> => {
			const isSingleton = dialecteConfig.singletonElements?.includes(tagName)

			let record

			if (isSingleton && !id) {
				record = await databaseInstance.table(tableName).where({ tagName }).first()
			} else if (id) {
				record = await databaseInstance.table(tableName).get({ id, tagName })
			} else {
				throw new Error(`Element ${tagName} requires an id parameter`)
			}

			assert(
				record,
				id
					? `Element "${tagName}" with id "${id}" not found in database`
					: `Element "${tagName}" not found in database`,
			)

			const apiRecord = toChainRecord<GenericConfig, GenericElement>({ record })

			return {
				currentFocus: apiRecord,
				stagedOperations: [],
			}
		},
	)

	return chain({
		contextPromise,
		dialecteConfig,
		databaseInstance,
		extensions,
		focusedTagName: tagName,
	}) as Chain<GenericConfig, GenericElement, GenericExtensionRegistry>
}
